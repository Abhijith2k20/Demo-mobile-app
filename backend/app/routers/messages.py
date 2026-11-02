"""Messages, threads, reactions, read markers and direct messages."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import db
from ..core import ApiError, forbidden, invalid, not_found, now_iso, now_ms, parse_iso_ms, uuid7
from ..deps import current_user
from ..events import publish
from ..rules import DELETE_WINDOW_MS, EDIT_WINDOW_MS, can, can_post, is_company_admin, is_guest
from ..schemas import DmOpen, MessageCreate, MessagePatch, Reaction, ReadMarker
from ..access import assert_project_active, channel_audience, visible_channel
from ..store import BOT_ID, MESSAGE_COLUMNS, add_channel_member, ensure_channel_member, message, person, project_managers, project_role
from ..views import channel_view, message_view, order_key, reply_info
from ..services.messaging import post_message

router = APIRouter(tags=["messages"])

CLIENT_TYPES = {"text", "image", "voice", "file", "issue_card", "daily_report"}


def _save(m: dict, changes: dict, kind: str, channel: dict) -> dict:
    m = db.update("messages", {"id": m["id"]}, {**changes, "updatedAt": now_iso()})
    m = message(m["id"])
    publish({"type": kind, "message": {k: v for k, v in m.items() if k != "companyId"}}, channel_audience(channel))
    return m


def _visible_message(user: dict, message_id: str) -> tuple[dict, dict]:
    m = message(message_id)
    if not m:
        raise not_found("Message")
    return m, visible_channel(user, m["channelId"])


@router.get("/channels/{channel_id}/messages")
def list_messages(channel_id: str, before: str | None = None, limit: int = Query(50, ge=1, le=100),
                  user: dict = Depends(current_user)):
    """Newest first. Top-level messages plus thread replies also sent to the channel."""
    ch = visible_channel(user, channel_id)
    anchor = message(before)
    cutoff = order_key(anchor) if anchor and anchor["channelId"] == ch["id"] else None
    page = db.rows(f"""SELECT {MESSAGE_COLUMNS} FROM messages m WHERE channel_id = %(c)s
                       AND (thread_parent_id IS NULL OR coalesce((data->>'alsoToChannel')::boolean, false))
                       AND (%(at)s::timestamptz IS NULL OR (created_at, id) < (%(at)s::timestamptz, %(id)s))
                       ORDER BY created_at DESC, id DESC LIMIT %(n)s""",
                   c=ch["id"], at=cutoff[0] if cutoff else None, id=cutoff[1] if cutoff else "", n=limit + 1)
    replies = reply_info(page[:limit])
    return {"messages": [message_view(m, user, ch, replies) for m in page[:limit]], "hasMore": len(page) > limit}


@router.get("/channels/{channel_id}/pins")
def list_pins(channel_id: str, user: dict = Depends(current_user)):
    ch = visible_channel(user, channel_id)
    pins = db.rows(f"""SELECT {MESSAGE_COLUMNS} FROM messages m WHERE channel_id = %(c)s AND deleted_at IS NULL
                       AND coalesce((data->>'pinned')::boolean, false) ORDER BY created_at DESC""", c=ch["id"])
    return {"messages": [message_view(m, user, ch) for m in pins]}


@router.get("/messages/{message_id}/thread")
def get_thread(message_id: str, user: dict = Depends(current_user)):
    parent, ch = _visible_message(user, message_id)
    replies = db.rows(f"SELECT {MESSAGE_COLUMNS} FROM messages m WHERE thread_parent_id = %(p)s ORDER BY created_at, id",
                      p=parent["id"])
    return {"parent": message_view(parent, user, ch), "replies": [message_view(m, user, ch) for m in replies]}


@router.post("/channels/{channel_id}/messages")
def create_message(channel_id: str, body: MessageCreate, user: dict = Depends(current_user)):
    ch = visible_channel(user, channel_id)
    if existing := message(body.id):
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
        parent = message(body.threadParentId)
        if not parent or parent["channelId"] != ch["id"]:
            raise not_found("Message")
    data = dict(body.data) if body.data else None
    # Files are referred to by this server's own upload records; links are signed when shown (views.py).
    for a in (data or {}).get("attachments", []) or []:
        _own_upload(user, a.get("uploadId"))
        a["uri"] = None
    if body.type in ("voice", "file"):
        upload = _own_upload(user, (data or {}).get("uploadId"))
        data = {**data, "uri": None, "name": upload["name"] or (data or {}).get("name"), "size": upload["size"]}
    if body.type == "issue_card" and data and data.get("urgency") == "urgent" and ch["projectId"]:
        # Urgent issues mention the project's Managers; the server decides who they are.
        data["mentions"] = [uid for uid in project_managers(ch["projectId"]) if uid != user["id"]]
    m = post_message(ch, user["id"], type=body.type, body=body.body, data=data,
                     thread_parent_id=body.threadParentId, id=body.id)
    return message_view(m, user, ch)


def _own_upload(user: dict, upload_id: str | None) -> dict:
    upload = db.row("SELECT * FROM uploads WHERE id = %(id)s", id=upload_id or "")
    if not upload or upload["userId"] != user["id"]:
        raise invalid({"attachments": "Upload not found"})
    return upload


@router.patch("/messages/{message_id}")
def patch_message(message_id: str, body: MessagePatch, user: dict = Depends(current_user)):
    m, ch = _visible_message(user, message_id)
    if m["deletedAt"]:
        raise not_found("Message")
    changes: dict = {}
    if body.body is not None:
        if m["senderId"] != user["id"]:
            raise forbidden("You can only edit your own messages.")
        if now_ms() - parse_iso_ms(m["createdAt"]) > EDIT_WINDOW_MS:
            raise ApiError("MESSAGE_EDIT_WINDOW_PASSED", "Messages can be edited for 15 minutes.")
        changes["body"] = body.body
        changes["data"] = {**(m["data"] or {}), "edited": True}
    if body.pinned is not None:
        role = project_role(user["id"], ch["projectId"]) if ch["projectId"] else None
        if not ch["projectId"] or not can(user, "message.pin", role):
            raise forbidden("Only managers can pin messages.")
        changes["data"] = {**(changes.get("data") or m["data"] or {}), "pinned": body.pinned}
    return message_view(_save(m, changes, "message.updated", ch), user, ch)


@router.delete("/messages/{message_id}")
def delete_message(message_id: str, user: dict = Depends(current_user)):
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
    changes = {"deletedAt": now_iso(), "body": None, "data": None, "reactions": {}}
    return message_view(_save(m, changes, "message.deleted", ch), user, ch)


@router.put("/messages/{message_id}/reactions/{emoji}")
def set_reaction(message_id: str, emoji: str, body: Reaction, user: dict = Depends(current_user)):
    m, ch = _visible_message(user, message_id)
    if m["deletedAt"]:
        raise not_found("Message")
    # Row lock: two people reacting at once can't overwrite each other.
    current = db.value("SELECT reactions FROM messages WHERE id = %(id)s FOR UPDATE", id=m["id"]) or {}
    people = set(current.get(emoji, []))
    (people.add if body.on else people.discard)(user["id"])
    reactions = {k: v for k, v in current.items() if k != emoji}
    if people:
        reactions[emoji] = sorted(people)
    return message_view(_save(m, {"reactions": reactions}, "message.updated", ch), user, ch)


@router.post("/channels/{channel_id}/read")
def mark_read(channel_id: str, body: ReadMarker, user: dict = Depends(current_user)):
    ch = visible_channel(user, channel_id)
    row = ensure_channel_member(user["id"], ch["id"])
    target = message(body.upToMessageId)
    current = message(row["lastReadMessageId"])
    # Only forward, by server time; an unknown or other-channel id changes nothing.
    marker = row["lastReadMessageId"]
    if target and target["channelId"] == ch["id"] and (not current or order_key(target) > order_key(current)):
        db.run("UPDATE channel_members SET last_read_message_id = %(m)s WHERE channel_id = %(c)s AND user_id = %(u)s",
               m=target["id"], c=ch["id"], u=user["id"])
        marker = target["id"]
    publish({"type": "channel.read", "channelId": ch["id"], "userId": user["id"]}, [user["id"]])
    return {"channelId": ch["id"], "lastReadMessageId": marker}


def _find_dm(a: str, b: str) -> dict | None:
    return db.row("""SELECT c.* FROM channels c WHERE c.kind = 'dm'
                     AND (SELECT array_agg(user_id ORDER BY user_id) FROM channel_members WHERE channel_id = c.id)
                         = %(pair)s::text[]""", pair=sorted([a, b]))


def _dm_peer(user: dict, user_id: str) -> dict:
    other = person(user_id)
    if not other or not other["isActive"] or other["id"] in (BOT_ID, user["id"]):
        raise not_found("Person")
    if is_guest(user) or is_guest(other):  # guests only talk to people they share a channel with
        shared = db.value("""SELECT 1 FROM channel_members a JOIN channel_members b ON b.channel_id = a.channel_id
                             JOIN channels c ON c.id = a.channel_id AND c.kind = 'project'
                             WHERE a.user_id = %(a)s AND b.user_id = %(b)s LIMIT 1""", a=user["id"], b=other["id"])
        if not shared:
            raise not_found("Person")
    return other


@router.get("/dms/{user_id}")
def get_dm(user_id: str, user: dict = Depends(current_user)):
    """The conversation with a person, or null if none yet (it is created by the first message)."""
    other = _dm_peer(user, user_id)
    ch = _find_dm(user["id"], other["id"])
    return {"channel": channel_view(ch, user) if ch else None}


@router.post("/dms")
def open_dm(body: DmOpen, user: dict = Depends(current_user)):
    other = _dm_peer(user, body.userId)
    # Two people opening the same DM at once must end up in one conversation.
    db.run("SELECT pg_advisory_xact_lock(hashtext(%(k)s))", k="dm:" + ":".join(sorted([user["id"], other["id"]])))
    if ch := _find_dm(user["id"], other["id"]):
        return {"channel": channel_view(ch, user)}
    ch = db.insert("channels", {"id": uuid7(), "companyId": db.company_id(), "projectId": None, "name": "", "kind": "dm",
                                "isPrivate": True, "postingPolicy": "everyone"})
    for uid in (user["id"], other["id"]):
        add_channel_member(ch["id"], uid)
        publish({"type": "channel.member_added", "channelId": ch["id"], "userId": uid}, [user["id"], other["id"]])
    return {"channel": channel_view(ch, user)}
