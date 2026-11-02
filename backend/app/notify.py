"""Activity items: mentions, thread replies, check-in results and escalations."""
from __future__ import annotations

from .core import now_iso, uuid7
from .events import publish
from .store import S


def public_activity(a: dict) -> dict:
    return {k: v for k, v in a.items() if k != "readAt"} | {"read": a.get("readAt") is not None}


def add_activity(**a) -> None:
    s = S()
    if a["userId"] == s.bot_id or a["userId"] == a["actorId"]:
        return
    activity = {"id": uuid7(), "createdAt": now_iso(), "readAt": None, **a}
    s.activities.append(activity)
    publish({"type": "activity.new", "activity": public_activity(activity)}, [a["userId"]])
