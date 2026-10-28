"""Posting a message: the one write path for messages (routes, the bot, scripted teammates).
Saves it, marks it read for the sender, publishes it and notifies mentions and thread replies."""
from __future__ import annotations

from ..core import now_iso, uuid7
from ..events import publish
from ..notify import add_activity
from ..access import channel_audience
from ..store import S, ensure_channel_member, first_name


def channel_label(ch: dict) -> str:
    return "a direct message" if ch["kind"] in ("dm", "bot") else f"#{ch['name']}"


def post_message(channel: dict, sender_id: str, *, type: str, body: str | None, data: dict | None = None,
                 thread_parent_id: str | None = None, id: str | None = None) -> dict:
    """The one write path for messages (routes, the bot, scripted teammates). Publishes and notifies."""
    s = S()
    ts = now_iso()
    message = {
        "id": id or uuid7(),
        "channelId": channel["id"],
        "senderId": sender_id,
        "type": type,
        "body": body,
        "data": data,
        "threadParentId": thread_parent_id,
        "reactions": {},
        "status": "sent",
        "createdAt": ts,
        "updatedAt": ts,
        "deletedAt": None,
    }
    s.messages[message["id"]] = message
    if sender_id != s.bot_id and not thread_parent_id:
        ensure_channel_member(sender_id, channel["id"])["lastReadMessageId"] = message["id"]
    audience = channel_audience(channel)
    publish({"type": "message.new", "message": message}, audience)

    mentions = [uid for uid in (data or {}).get("mentions", []) if uid in set(audience)]
    for uid in mentions:
        add_activity(
            userId=uid, kind="mention", actorId=sender_id, projectId=channel["projectId"], channelId=channel["id"],
            messageId=thread_parent_id or message["id"], taskIds=[],
            text=f"{first_name(sender_id)} mentioned you in {channel_label(channel)}",
            lines=[body or (data or {}).get("what") or ""],
        )
    if thread_parent_id:
        parent = s.messages.get(thread_parent_id)
        participants = {parent["senderId"]} if parent else set()
        participants |= {m["senderId"] for m in s.messages.values() if m["threadParentId"] == thread_parent_id}
        for uid in participants - set(mentions):
            add_activity(
                userId=uid, kind="thread_reply", actorId=sender_id, projectId=channel["projectId"],
                channelId=channel["id"], messageId=thread_parent_id, taskIds=[],
                text=f"{first_name(sender_id)} replied in a thread in {channel_label(channel)}", lines=[body or ""],
            )
    return message
