"""What each kind of job does (spec §10.6). Each runs in a transaction for its company; the job is marked done
in that same transaction, so its effects and "done" commit together."""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from .. import bot, db
from ..pm import connector as pm
from ..pm.sync import full_sync
from ..senders import email, push, sms
from ..services.accounts import is_phone
from .queue import enqueue

log = logging.getLogger("siteline.jobs")


class Retry(Exception):
    """Try the job again later (the PM app or a sender didn't answer)."""


def _tz() -> ZoneInfo:
    return ZoneInfo(db.value("SELECT time_zone FROM companies WHERE id = current_company()"))


def _next_local(hhmm: str, after: datetime | None = None) -> datetime:
    tz = _tz()
    now = after or datetime.now(tz)
    h, m = map(int, hhmm.split(":"))
    at = datetime.combine(now.date(), time(h, m), tzinfo=tz)
    return at if at > now else at + timedelta(days=1)


def send_code(p: dict) -> None:
    if is_phone(p["identifier"]):
        sms.send(p["identifier"], "code", {"code": p["code"]})
    else:
        email.send(p["identifier"], f"{p['code']} is your Siteline code",
                   f"Your Siteline sign-in code is {p['code']}. It works for 10 minutes.\n\n"
                   "If you didn't ask for it, you can ignore this email.")


def send_invite(p: dict) -> None:
    if is_phone(p["identifier"]):
        sms.send(p["identifier"], "invite", {"inviter": p["inviter"], "company": p["company"], "link": p["link"]})
    else:
        email.send(p["identifier"], f"{p['inviter']} invited you to {p['company']} on Siteline",
                   f"{p['inviter']} invited you to {p['company']} on Siteline.\n\nGet the app: {p['link']}\n\n"
                   f"Sign in with this email address ({p['identifier']}) to join.")


def send_push(p: dict) -> None:
    tokens = [r["token"] for r in db.rows("SELECT token FROM push_tokens WHERE user_id = %(u)s", u=p["userId"])]
    for dead in push.send(tokens, p["title"], p["body"], p.get("data") or {}):
        db.run("DELETE FROM push_tokens WHERE token = %(t)s", t=dead)


def pm_sync(p: dict) -> None:
    try:
        full_sync()
    except pm.Unavailable as e:
        raise Retry(str(e)) from e
    finally:
        # Nightly at 02:00 company time (§9.3), whatever happened this time.
        nxt = _next_local("02:00")
        enqueue("pm_sync", {}, run_at=nxt, dedupe_key=f"pm_sync:{db.company_id()}:{nxt.date()}")


def plan_day(p: dict) -> None:
    """Queues today's summaries and check-ins, then itself for the next midnight."""
    today = bot.today()
    now = datetime.now(bot.zone())
    s = bot.settings()
    if today.weekday() in s["workingDays"]:
        for o in db.rows("""SELECT DISTINCT owner_user_id AS user_id FROM pm_tasks WHERE owner_user_id IS NOT NULL
                            AND removed_at IS NULL AND status IN ('not_started', 'in_progress', 'blocked')"""):
            for kind, at in (("morning_summary", s["morningSummaryAt"]), ("evening_checkins", s["checkinAt"])):
                run_at = bot.local_time(today, at)
                if run_at > now:  # a company created at 14:00 doesn't get a late morning summary
                    enqueue(kind, {"userId": o["userId"]}, run_at=run_at,
                            dedupe_key=f"{kind}:{db.company_id()}:{o['userId']}:{today}")
    nxt = _next_local("00:01")
    enqueue("plan_day", {}, run_at=nxt, dedupe_key=f"plan_day:{db.company_id()}:{nxt.date()}")


def pm_write(p: dict) -> None:
    try:
        bot.write_answer(p["checkinId"])
    except pm.Unavailable as e:
        raise Retry(str(e)) from e


def cleanup(p: dict) -> None:
    db.run("DELETE FROM events WHERE created_at < now() - interval '10 minutes'")
    db.run("DELETE FROM jobs WHERE status IN ('done', 'cancelled') AND updated_at < now() - interval '7 days'")
    db.run("DELETE FROM otp_requests WHERE at < now() - interval '1 hour'")
    db.run("DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'")
    db.run("UPDATE invites SET status = 'cancelled' WHERE status = 'pending' AND expires_at < now() - interval '30 days'")
    enqueue("cleanup", {}, run_at=datetime.now(ZoneInfo("UTC")) + timedelta(hours=1), company_id=None,
            dedupe_key=f"cleanup:{datetime.now(ZoneInfo('UTC')):%Y-%m-%dT%H}")


HANDLERS = {
    "send_code": send_code,
    "send_invite": send_invite,
    "send_push": send_push,
    "pm_sync": pm_sync,
    "plan_day": plan_day,
    "morning_summary": lambda p: bot.send_morning_summary(p["userId"]),
    "evening_checkins": lambda p: bot.evening_checkins(p["userId"]),
    "remind": lambda p: bot.remind(p["checkinId"]),
    "escalate": lambda p: bot.escalate(p["checkinId"]),
    "pm_write": pm_write,
    "cleanup": cleanup,
}

# Jobs that stop when their company is suspended (sign-in codes and cleanup don't belong to a company).
COMPANY_JOBS = set(HANDLERS) - {"send_code", "cleanup"}


def on_gave_up(job: dict) -> None:
    """After the last retry."""
    if job["kind"] == "pm_write":
        bot.write_gave_up(job["payload"]["checkinId"])
