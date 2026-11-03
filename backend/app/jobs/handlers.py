"""What each kind of job does (spec §10.6). Each runs in a transaction for its company; the job is marked done
in that same transaction, so its effects and "done" commit together."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .. import db
from ..mockpm import bot as mock
from ..services import integrations
from ..senders import email, push, sms
from ..services.accounts import is_phone
from .queue import enqueue

log = logging.getLogger("siteline.jobs")


class Retry(Exception):
    """Try the job again later (the PM app or a sender didn't answer)."""


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


def webhook(p: dict) -> None:
    try:
        integrations.deliver(p)
    except integrations.Unreachable as e:
        raise Retry(str(e)) from e


def cleanup(p: dict) -> None:
    db.run("DELETE FROM events WHERE created_at < now() - interval '10 minutes'")
    db.run("DELETE FROM jobs WHERE status IN ('done', 'cancelled') AND updated_at < now() - interval '7 days'")
    db.run("DELETE FROM api_calls WHERE minute < now() - interval '1 hour'")
    db.run("DELETE FROM otp_requests WHERE at < now() - interval '1 hour'")
    db.run("DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'")
    db.run("UPDATE invites SET status = 'cancelled' WHERE status = 'pending' AND expires_at < now() - interval '30 days'")
    enqueue("cleanup", {}, run_at=datetime.now(ZoneInfo("UTC")) + timedelta(hours=1), company_id=None,
            dedupe_key=f"cleanup:{datetime.now(ZoneInfo('UTC')):%Y-%m-%dT%H}")


HANDLERS = {
    "send_code": send_code,
    "send_invite": send_invite,
    "send_push": send_push,
    "webhook": webhook,
    # The mock PM app's own timers (a real PM app runs these on its side).
    "mock_plan_day": mock.plan_day,
    "mock_summary": lambda p: mock.morning_summary(p["ref"]),
    "mock_checkins": lambda p: mock.evening_checkins(p["ref"]),
    "mock_remind": lambda p: mock.remind(p["card"]),
    "cleanup": cleanup,
}

# Jobs that stop when their company is suspended (sign-in codes and cleanup don't belong to a company).
COMPANY_JOBS = set(HANDLERS) - {"send_code", "cleanup"}


def on_gave_up(job: dict) -> None:
    """After the last retry."""
    if job["kind"] == "webhook":
        integrations.gave_up(job["payload"])
