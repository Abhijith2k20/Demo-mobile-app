"""Channels: the list behind Home and DMs, browse, create, edit, join and leave."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..core import ApiError, forbidden, invalid, not_found, now_iso
from ..deps import current_user
from ..events import publish
from ..rules import HOME_CHANNEL, can, channel_rank, is_company_admin
from ..schemas import ChannelCreate, ChannelPatch
from ..access import (
    can_see_channel,
    channel_audience,
    project_audience,
    visible_channel,
    visible_project,
)
from ..store import (
    S,
    admins,
    ensure_channel_member,
    first_name,
    is_channel_member,
    project_managers,
    project_member_ids,
    project_role,
    setup,
)
from ..views import channel_stats, channel_view
from ..services.messaging import post_message

router = APIRouter(tags=["channels"])


def _manager(user: dict, project_id: str) -> bool:
    return can(user, "channel.manage", project_role(user["id"], project_id))


def _project_channel(user: dict, channel_id: str) -> tuple[dict, dict]:
    ch = S().channels.get(channel_id)
    if not ch or ch["kind"] != "project" or not ch["projectId"]:
        raise not_found("Channel")
    project = visible_project(user, ch["projectId"])
    # Private channels are invisible to project members who aren't in them (managers excepted).
    if ch["isPrivate"] and not is_company_admin(user) and not is_channel_member(user["id"], ch["id"]) \
            and not _manager(user, project["id"]):
        raise not_found("Channel")
    return ch, project


def _require_manage(user: dict, project: dict) -> None:
    if not _manager(user, project["id"]):
        raise forbidden("Only managers can manage channels.")


def _assert_name_free(project_id: str, name: str, except_id: str | None = None) -> None:
    if any(c["projectId"] == project_id and c["name"] == name and c["id"] != except_id for c in S().channels.values()):
        raise ApiError("CHANNEL_NAME_TAKEN", "This project already has a channel with that name.",
                       {"fields": {"name": "Name already used"}})


def _add(ch: dict, user_id: str) -> None:
    if is_channel_member(user_id, ch["id"]):
        return
    S().channel_members.append({"channelId": ch["id"], "userId": user_id, "lastReadMessageId": None, "joinedAt": now_iso()})
    publish({"type": "channel.member_added", "channelId": ch["id"], "userId": user_id}, [*channel_audience(ch), user_id])


def _remove(ch: dict, user_id: str) -> None:
    s = S()
    row = next((m for m in s.channel_members if m["channelId"] == ch["id"] and m["userId"] == user_id), None)
    if not row:
        return
    audience = [*channel_audience(ch), user_id]
    s.channel_members.remove(row)
    publish({"type": "channel.member_removed", "channelId": ch["id"], "userId": user_id}, audience)


def _set_members(ch: dict, ids: list[str]) -> None:
    """The channel's project members become exactly `ids` (Owner/Admin rows are left alone)."""
    allowed = project_member_ids(ch["projectId"])
    # Managers are in every channel of their project (§9.3), so they're never removed.
    want = {i for i in ids if i in allowed} | set(project_managers(ch["projectId"]))
    current = [m["userId"] for m in S().channel_members if m["channelId"] == ch["id"] and m["userId"] in allowed]
    for uid in current:
        if uid not in want:
            _remove(ch, uid)
    for uid in want:
        _add(ch, uid)


@router.get("/channels")
async def list_channels(user: dict = Depends(current_user)):
    """Every channel the user can read, with unread count, last message and members."""
    s = S()
    has_messages = {m["channelId"] for m in s.messages.values()}
    # A DM opened but never written in stays invisible, for both people.
    visible = [c for c in s.channels.values() if can_see_channel(user, c) and (c["kind"] != "dm" or c["id"] in has_messages)]
    for c in visible:
        if c["kind"] not in ("dm", "bot"):
            ensure_channel_member(user["id"], c["id"])  # read markers for Owner/Admin
    stats = channel_stats(user)
    views = [channel_view(c, user, stats) for c in visible]
    return {"channels": _in_display_order(views)}


def _in_display_order(views: list[dict]) -> list[dict]:
    """Project channels in the company's standard order, then company channels (admin-only
    ones like announcements first), the bot, and DMs with the latest conversation first."""
    st = setup()
    by_kind = {k: [v for v in views if v["kind"] == k] for k in ("project", "company", "bot", "dm")}
    by_kind["project"].sort(key=lambda v: (v["projectId"], channel_rank(st, v)))
    by_kind["company"].sort(key=lambda v: (v["postingPolicy"] != "admins", v["name"]))
    by_kind["dm"].sort(key=lambda v: (v["lastMessage"] or {}).get("createdAt", ""), reverse=True)
    return [v for k in ("project", "company", "bot", "dm") for v in by_kind[k]]


@router.get("/channels/{channel_id}")
async def get_channel(channel_id: str, user: dict = Depends(current_user)):
    return channel_view(visible_channel(user, channel_id), user)


@router.get("/projects/{project_id}/channels")
async def browse_channels(project_id: str, user: dict = Depends(current_user)):
    """Every channel the user may know about in a project, joined or not (for "Browse channels")."""
    s = S()
    project = visible_project(user, project_id)
    manager = _manager(user, project["id"])
    on_project = project_member_ids(project["id"])
    out = []
    for c in s.channels.values():
        if c["projectId"] != project["id"] or (c["isPrivate"] and not manager and not is_channel_member(user["id"], c["id"])):
            continue
        count = sum(1 for m in s.channel_members if m["channelId"] == c["id"] and m["userId"] in on_project)
        out.append({**channel_view(c, user), "memberCount": count})
    return {"channels": sorted(out, key=lambda v: channel_rank(setup(), v))}


@router.post("/projects/{project_id}/channels")
async def create_channel(project_id: str, body: ChannelCreate, user: dict = Depends(current_user)):
    s = S()
    project = visible_project(user, project_id)
    _require_manage(user, project)
    if existing := s.channels.get(body.id):
        if existing["projectId"] == project["id"]:
            return {"channel": channel_view(existing, user)}  # a retry
        raise ApiError("VALIDATION_FAILED", "Some fields need attention.", {"fields": {"id": "Already used"}})
    _assert_name_free(project["id"], body.name)
    ch = {"id": body.id, "companyId": s.company_id, "projectId": project["id"], "name": body.name, "kind": "project",
          "isPrivate": body.isPrivate, "postingPolicy": "everyone", "updatedAt": now_iso()}
    s.channels[ch["id"]] = ch
    members = {i for i in body.memberIds if i in project_member_ids(project["id"])}
    for uid in [*members, *project_managers(project["id"]), *admins(), user["id"]]:
        _add(ch, uid)
    post_message(ch, s.bot_id, type="system", body=f"{first_name(user['id'])} created #{ch['name']}")
    return {"channel": channel_view(ch, user)}


@router.patch("/channels/{channel_id}")
async def patch_channel(channel_id: str, body: ChannelPatch, user: dict = Depends(current_user)):
    ch, project = _project_channel(user, channel_id)
    _require_manage(user, project)
    home = ch["name"] == HOME_CHANNEL
    if body.name is not None and body.name != ch["name"]:
        if home:
            raise invalid({"name": "#general cannot be renamed"})
        _assert_name_free(project["id"], body.name, ch["id"])
        ch["name"] = body.name
    if body.isPrivate is not None and body.isPrivate != ch["isPrivate"]:
        if home and body.isPrivate:
            raise invalid({"isPrivate": "#general stays open to the whole project"})
        ch["isPrivate"] = body.isPrivate
        post_message(ch, S().bot_id, type="system",
                     body=f"{first_name(user['id'])} made this channel {'private' if ch['isPrivate'] else 'public'}")
    ch["updatedAt"] = now_iso()
    if body.memberIds is not None:
        _set_members(ch, body.memberIds)
    publish({"type": "channel.updated", "channel": ch}, [*channel_audience(ch), *project_audience(project["id"])])
    return {"channel": channel_view(ch, user)}


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: str, user: dict = Depends(current_user)):
    s = S()
    if channel_id not in s.channels:
        return {"deleted": True}  # already gone: safe to repeat
    ch, project = _project_channel(user, channel_id)
    _require_manage(user, project)
    if ch["name"] == HOME_CHANNEL:
        raise invalid({"name": "#general cannot be deleted"})
    audience = channel_audience(ch)
    s.messages = {k: m for k, m in s.messages.items() if m["channelId"] != ch["id"]}
    for t in s.tasks.values():
        if t["channelId"] == ch["id"]:
            t["channelId"] = None
    s.channel_members = [m for m in s.channel_members if m["channelId"] != ch["id"]]
    del s.channels[ch["id"]]
    publish({"type": "channel.deleted", "channelId": ch["id"]}, audience)
    return {"deleted": True}


@router.post("/channels/{channel_id}/join")
async def join_channel(channel_id: str, user: dict = Depends(current_user)):
    ch = S().channels.get(channel_id)
    if not ch or ch["kind"] != "project" or not ch["projectId"]:
        raise not_found("Channel")
    visible_project(user, ch["projectId"])
    if ch["isPrivate"] and not is_channel_member(user["id"], ch["id"]):
        raise ApiError("CHANNEL_PRIVATE", "This channel is private. Ask a manager to add you.")
    _add(ch, user["id"])
    return {"channel": channel_view(ch, user)}


@router.post("/channels/{channel_id}/leave")
async def leave_channel(channel_id: str, user: dict = Depends(current_user)):
    ch = S().channels.get(channel_id)
    if not ch or ch["kind"] != "project":
        return {"left": True}
    if ch["name"] == HOME_CHANNEL:
        raise invalid({"name": "Everyone stays in #general"})
    if ch["projectId"] and user["id"] in project_managers(ch["projectId"]):
        raise invalid({"name": "Managers stay in every channel"})
    _remove(ch, user["id"])
    return {"left": True}
