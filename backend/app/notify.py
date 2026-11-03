"""Activity items (mentions, thread replies, notices from the PM app) and push notifications."""
from __future__ import annotations

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


def push(user_ids: list[str], title: str, body: str, data: dict, *, kind: str) -> None:
    """Queues a push to each person who wants this kind (their notification level)."""
    ids = [u for u in dict.fromkeys(user_ids) if u != BOT_ID]
    if not ids:
        return
    for r in db.rows("SELECT id, notify FROM users WHERE id = ANY(%(ids)s) AND deleted_at IS NULL", ids=ids):
        prefs = r["notify"] or {}
        if kind not in LEVELS.get(prefs.get("level", "all"), LEVELS["all"]):
            continue
        enqueue("send_push", {"userId": r["id"], "title": title, "body": body[:180], "data": data})
