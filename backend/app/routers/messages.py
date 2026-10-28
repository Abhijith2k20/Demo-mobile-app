"""Messages, threads, reactions, read markers and direct messages."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..core import ApiError, forbidden, invalid, not_found, now_iso, now_ms, parse_iso_ms, uuid7
from ..deps import current_user
from ..events import publish
from ..rules import DELETE_WINDOW_MS, EDIT_WINDOW_MS, can, can_post, is_company_admin
from ..schemas import DmOpen, MessageCreate, MessagePatch, Reaction, ReadMarker
from ..access import assert_project_active, channel_audience, visible_channel
from ..store import S, ensure_channel_member, project_managers, project_role
from ..views import channel_view, message_view, order_key, reply_info
from ..services.messaging import post_message

router = APIRouter(tags=["messages"])

CLIENT_TYPES = {"text", "image", "voice", "file", "task_card", "issue_card", "daily_report"}


def _touch(message: dict, kind: str, channel: dict) -> dict:
    message["updatedAt"] = now_iso()
    publish({"type": kind, "message": message}, channel_audience(channel))
    return message


def _visible_message(user: dict, message_id: str) -> tuple[dict, dict]:
    m = S().messages.get(message_id)
    if not m:
        raise not_found("Message")
    return m, visible_channel(user, m["channelId"])


@router.get("/channels/{channel_id}/messages")
async def list_messages(channel_id: str, before: str | None = None, limit: int = Query(50, ge=1, le=100),
                        user: dict = Depends(current_user)):
    """Newest first. Top-level messages plus thread replies also sent to the channel."""
    ch = visible_channel(user, channel_id)
    anchor = S().messages.get(before or "")
    cutoff = order_key(anchor) if anchor and anchor["channelId"] == ch["id"] else None
    items = sorted(
        (m for m in S().messages.values()
         if m["channelId"] == ch["id"] and (not cutoff or order_key(m) < cutoff)
         and (not m["threadParentId"] or (m["data"] or {}).get("alsoToChannel"))),
        key=order_key, reverse=True,
    )
    page = items[:limit]
    replies = reply_info(page)
    return {"messages": [message_view(m, user, ch, replies) for m in page], "hasMore": len(items) > limit}


@router.get("/channels/{channel_id}/pins")
async def list_pins(channel_id: str, user: dict = Depends(current_user)):
    ch = visible_channel(user, channel_id)
    pins = sorted((m for m in S().messages.values() if m["channelId"] == ch["id"] and not m["deletedAt"]
                   and (m["data"] or {}).get("pinned")), key=lambda m: m["createdAt"], reverse=True)
    return {"messages": [message_view(m, user, ch) for m in pins]}


@router.get("/messages/{message_id}/thread")
async def get_thread(message_id: str, user: dict = Depends(current_user)):
    parent, ch = _visible_message(user, message_id)
    replies = sorted((m for m in S().messages.values() if m["threadParentId"] == parent["id"]),
                     key=lambda m: (m["createdAt"], m["id"]))
    return {"parent": message_view(parent, user, ch), "replies": [message_view(m, user, ch) for m in replies]}


@router.post("/channels/{channel_id}/messages")
async def create_message(channel_id: str, body: MessageCreate, user: dict = Depends(current_user)):
    s = S()
    ch = visible_channel(user, channel_id)
    if existing := s.messages.get(body.id):
        # Idempotent only for the same sender in the same channel; any other match is someone
        # else's message, and must not be handed back.
        if existing["channelId"] == ch["id"] and existing["senderId"] == user["id"]:
            return message_view(existing, user, ch)  # a retry: no second event
        raise ApiError("VALIDATION_FAILED", "Some fields need attention.", {"fields": {"id": "Already used"}})
    assert_project_active(ch["projectId"])
    if not can_post(user, ch):
        raise ApiError("CHANNEL_READ_ONLY", "Only admins can post here.")
    if body.type not in CLIENT_TYPES:
        raise invalid({"type": "Not allowed"})
    if body.type == "text" and not (body.body or "").strip():
        raise invalid({"body": "Write a message"})
    if body.threadParentId:
        parent = s.messages.get(body.threadParentId)
        if not parent or parent["channelId"] != ch["id"]:
            raise not_found("Message")
    data = dict(body.data) if body.data else None
    # A photo link always comes from this server's own upload record, never from the app.
    for a in (data or {}).get("attachments", []) or []:
        upload = s.uploads.get(a.get("uploadId") or "")
        if not upload or upload["userId"] != user["id"]:
            raise invalid({"attachments": "Upload not found"})
        a["uri"] = upload["url"]
    if body.type == "issue_card" and data and data.get("urgency") == "urgent" and ch["projectId"]:
        # Urgent issues mention the project's Managers; the server decides who they are.
        data["mentions"] = [uid for uid in project_managers(ch["projectId"]) if uid != user["id"]]
    m = post_message(ch, user["id"], type=body.type, body=body.body, data=data,
                     thread_parent_id=body.threadParentId, id=body.id)
    return message_view(m, user, ch)


@router.patch("/messages/{message_id}")
async def patch_message(message_id: str, body: MessagePatch, user: dict = Depends(current_user)):
    m, ch = _visible_message(user, message_id)
    if m["deletedAt"]:
        raise not_found("Message")
    if body.body is not None:
        if m["senderId"] != user["id"]:
            raise forbidden("You can only edit your own messages.")
        if now_ms() - parse_iso_ms(m["createdAt"]) > EDIT_WINDOW_MS:
            raise ApiError("MESSAGE_EDIT_WINDOW_PASSED", "Messages can be edited for 15 minutes.")
        m["body"] = body.body
        m["data"] = {**(m["data"] or {}), "edited": True}
    if body.pinned is not None:
        role = project_role(user["id"], ch["projectId"]) if ch["projectId"] else None
        if not ch["projectId"] or not can(user, "message.pin", role):
            raise forbidden("Only managers can pin messages.")
        m["data"] = {**(m["data"] or {}), "pinned": body.pinned}
    return message_view(_touch(m, "message.updated", ch), user, ch)


@router.delete("/messages/{message_id}")
async def delete_message(message_id: str, user: dict = Depends(current_user)):
    m, ch = _visible_message(user, message_id)
    if m["deletedAt"]:
        return message_view(m, user, ch)
    if ch["projectId"]:
        can_any = can(user, "message.delete_any", project_role(user["id"], ch["projectId"]))
    else:
        can_any = is_company_admin(user) and ch["kind"] == "company"
    if not can_any:
        if m["senderId"] != user["id"]:
            raise forbidden("You can only delete your own messages.")
        if now_ms() - parse_iso_ms(m["createdAt"]) > DELETE_WINDOW_MS:
            raise ApiError("MESSAGE_EDIT_WINDOW_PASSED", "Messages can be deleted for 1 hour.")
    m.update(deletedAt=now_iso(), body=None, data=None, reactions={})
    return message_view(_touch(m, "message.deleted", ch), user, ch)


@router.put("/messages/{message_id}/reactions/{emoji}")
async def set_reaction(message_id: str, emoji: str, body: Reaction, user: dict = Depends(current_user)):
    m, ch = _visible_message(user, message_id)
    if m["deletedAt"]:
        raise not_found("Message")
    people = set(m["reactions"].get(emoji, []))
    (people.add if body.on else people.discard)(user["id"])
    reactions = {k: v for k, v in m["reactions"].items() if k != emoji}
    if people:
        reactions[emoji] = sorted(people)
    m["reactions"] = reactions
    return message_view(_touch(m, "message.updated", ch), user, ch)


@router.post("/channels/{channel_id}/read")
async def mark_read(channel_id: str, body: ReadMarker, user: dict = Depends(current_user)):
    ch = visible_channel(user, channel_id)
    row = ensure_channel_member(user["id"], ch["id"])
    target = S().messages.get(body.upToMessageId)
    current = S().messages.get(row["lastReadMessageId"] or "")
    # Only forward, by server time; an unknown or other-channel id changes nothing.
    if target and target["channelId"] == ch["id"] and (not current or order_key(target) > order_key(current)):
        row["lastReadMessageId"] = target["id"]
    publish({"type": "channel.read", "channelId": ch["id"], "userId": user["id"]}, [user["id"]])
    return {"channelId": ch["id"], "lastReadMessageId": row["lastReadMessageId"]}


def _find_dm(a: str, b: str) -> dict | None:
    s = S()
    for c in s.channels.values():
        if c["kind"] != "dm":
            continue
        members = {m["userId"] for m in s.channel_members if m["channelId"] == c["id"]}
        if members == {a, b}:
            return c
    return None


def _dm_peer(user: dict, user_id: str) -> dict:
    s = S()
    other = s.users.get(user_id)
    if not other or not other["isActive"] or other["id"] in (s.bot_id, user["id"]):
        raise not_found("Person")
    return other


@router.get("/dms/{user_id}")
async def get_dm(user_id: str, user: dict = Depends(current_user)):
    """The conversation with a person, or null if none yet (it is created by the first message)."""
    other = _dm_peer(user, user_id)
    ch = _find_dm(user["id"], other["id"])
    return {"channel": channel_view(ch, user) if ch else None}


@router.post("/dms")
async def open_dm(body: DmOpen, user: dict = Depends(current_user)):
    s = S()
    other = _dm_peer(user, body.userId)
    if ch := _find_dm(user["id"], other["id"]):
        return {"channel": channel_view(ch, user)}
    ts = now_iso()
    ch = {"id": uuid7(), "companyId": s.company_id, "projectId": None, "name": "", "kind": "dm",
          "isPrivate": True, "postingPolicy": "everyone", "updatedAt": ts}
    s.channels[ch["id"]] = ch
    for uid in (user["id"], other["id"]):
        s.channel_members.append({"channelId": ch["id"], "userId": uid, "lastReadMessageId": None, "joinedAt": ts})
        publish({"type": "channel.member_added", "channelId": ch["id"], "userId": uid}, [user["id"], other["id"]])
    return {"channel": channel_view(ch, user)}
