"""Activity items (mentions, thread replies, notices from the PM app) and push notifications."""
from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from . import db
from .core import now_iso, uuid7
from .events import publish
from .jobs.queue import enqueue
from .store import BOT_ID

# Which pushes each notification level sends (You → Notifications, spec §5.9).
LEVELS = {
    "all": {"dm", "mention", "thread", "card", "notice", "issue"},
    "important": {"dm", "mention", "card", "notice", "issue"},
    "off": set(),
}


def public_activity(a: dict) -> dict:
    return {k: v for k, v in a.items() if k not in ("readAt", "companyId")} | {"read": a.get("readAt") is not None}


def add_activity(**a) -> None:
    if a["userId"] == BOT_ID or a["userId"] == a["actorId"]:
        return
    activity = db.insert("activities", {"id": uuid7(), "companyId": db.company_id(), "createdAt": now_iso(), "readAt": None, **a})
    publish({"type": "activity.new", "activity": public_activity(activity)}, [a["userId"]])


def _quiet_until(prefs: dict, tz: ZoneInfo) -> datetime | None:
    """End of the person's quiet hours if it's quiet now (cards wait for it; §5.9)."""
    start, end = prefs.get("quietFrom"), prefs.get("quietTo")
    if not start or not end:
        return None
    now = datetime.now(tz)
    s, e = (time(*map(int, x.split(":"))) for x in (start, end))
    t = now.time()
    quiet = (s <= t or t < e) if s > e else (s <= t < e)
    if not quiet:
        return None
    until = datetime.combine(now.date(), e, tzinfo=tz)
    return until if until > now else until + timedelta(days=1)


def push(user_ids: list[str], title: str, body: str, data: dict, *, kind: str) -> None:
    """Queues a push to each person who wants this kind; cards wait until their quiet hours end."""
    ids = [u for u in dict.fromkeys(user_ids) if u != BOT_ID]
    if not ids:
        return
    tz = ZoneInfo(db.value("SELECT time_zone FROM companies WHERE id = current_company()") or "UTC")
    for r in db.rows("SELECT id, notify FROM users WHERE id = ANY(%(ids)s) AND deleted_at IS NULL", ids=ids):
        prefs = r["notify"] or {}
        if kind not in LEVELS.get(prefs.get("level", "all"), LEVELS["all"]):
            continue
        run_at = _quiet_until(prefs, tz) if kind == "card" else None
        enqueue("send_push", {"userId": r["id"], "title": title, "body": body[:180], "data": data}, run_at=run_at)
