"""Posting a message: the one write path for messages (routes, the bot, scripted teammates).
Saves it, marks it read for the sender, publishes it, and notifies mentions, thread replies and DMs."""
from __future__ import annotations

from .. import db
from ..core import now_iso, uuid7
from ..events import publish
from ..notify import add_activity, push
from ..access import channel_audience
from ..store import BOT_ID, MESSAGE_COLUMNS, ensure_channel_member, first_name, message


def channel_label(ch: dict) -> str:
    return "a direct message" if ch["kind"] in ("dm", "bot") else f"#{ch['name']}"


def _preview(type: str, body: str | None, data: dict | None) -> str:
    if body:
        return body
    return {"image": "Photo", "voice": "Voice note", "file": "File"}.get(type, "New message")


def post_message(channel: dict, sender_id: str, *, type: str, body: str | None, data: dict | None = None,
                 thread_parent_id: str | None = None, id: str | None = None) -> dict:
    ts = now_iso()
    m = db.insert("messages", {
        "id": id or uuid7(), "companyId": db.company_id(), "channelId": channel["id"], "senderId": sender_id,
        "type": type, "body": body, "data": data, "threadParentId": thread_parent_id, "reactions": {},
        "createdAt": ts, "updatedAt": ts, "deletedAt": None,
    })
    m = message(m["id"])
    if sender_id != BOT_ID and not thread_parent_id:
        ensure_channel_member(sender_id, channel["id"])
        db.run("UPDATE channel_members SET last_read_message_id = %(m)s WHERE channel_id = %(c)s AND user_id = %(u)s",
               m=m["id"], c=channel["id"], u=sender_id)
    audience = channel_audience(channel)
    publish({"type": "message.new", "message": {k: v for k, v in m.items() if k != "companyId"}}, audience)
    if sender_id == BOT_ID:
        return m

    who = first_name(sender_id)
    preview = _preview(type, body, data)
    mentions = [uid for uid in (data or {}).get("mentions", []) if uid in set(audience)]
    for uid in mentions:
        add_activity(
            userId=uid, kind="mention", actorId=sender_id, projectId=channel["projectId"], channelId=channel["id"],
            messageId=thread_parent_id or m["id"],
            text=f"{who} mentioned you in {channel_label(channel)}", lines=[body or ""],
        )
    url = f"/thread/{thread_parent_id}" if thread_parent_id else f"/channel/{channel['id']}"
    push(mentions, f"{who} in {channel_label(channel)}", preview, {"url": url}, kind="mention")
    if channel["kind"] == "dm":
        push([uid for uid in audience if uid != sender_id], who, preview, {"url": url}, kind="dm", channel_id=channel["id"])
    if thread_parent_id:
        parent = message(thread_parent_id)
        participants = {parent["senderId"]} if parent else set()
        participants |= {r["senderId"] for r in db.rows(f"SELECT {MESSAGE_COLUMNS} FROM messages m WHERE thread_parent_id = %(p)s",
                                                        p=thread_parent_id)}
        repliers = participants - set(mentions) - {sender_id, BOT_ID}
        for uid in repliers:
            add_activity(
                userId=uid, kind="thread_reply", actorId=sender_id, projectId=channel["projectId"],
                channelId=channel["id"], messageId=thread_parent_id,
                text=f"{who} replied in a thread in {channel_label(channel)}", lines=[body or ""],
            )
        push(list(repliers), f"{who} replied in {channel_label(channel)}", preview, {"url": url}, kind="thread",
             channel_id=channel["id"])
    return m
