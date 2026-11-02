"""Channels: the list behind Home and DMs, browse, create, edit, join and leave."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db
from ..core import ApiError, forbidden, invalid, not_found, now_iso
from ..deps import current_user
from ..events import publish
from ..rules import HOME_CHANNEL, can, channel_rank, is_company_admin, is_guest
from ..schemas import ChannelCreate, ChannelPatch
from ..access import can_see_channel, channel_audience, project_audience, visible_channel, visible_project
from ..store import (
    BOT_ID,
    add_channel_member,
    admins,
    channel,
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
    ch = channel(channel_id)
    if not ch or ch["kind"] != "project" or not ch["projectId"]:
        raise not_found("Channel")
    project = visible_project(user, ch["projectId"])
    # Private channels are invisible to project members who aren't in them (managers excepted).
    if not can_see_channel(user, ch) and not _manager(user, project["id"]) and (ch["isPrivate"] or is_guest(user)):
        raise not_found("Channel")
    return ch, project


def _require_manage(user: dict, project: dict) -> None:
    if not _manager(user, project["id"]):
        raise forbidden("Only managers can manage channels.")


def _assert_name_free(project_id: str, name: str, except_id: str | None = None) -> None:
    if db.value("SELECT 1 FROM channels WHERE project_id = %(p)s AND name = %(n)s AND id <> %(id)s",
                p=project_id, n=name, id=except_id or ""):
        raise ApiError("CHANNEL_NAME_TAKEN", "This project already has a channel with that name.",
                       {"fields": {"name": "Name already used"}})


def _add(ch: dict, user_id: str) -> None:
    if add_channel_member(ch["id"], user_id):
        publish({"type": "channel.member_added", "channelId": ch["id"], "userId": user_id}, [*channel_audience(ch), user_id])


def _remove(ch: dict, user_id: str) -> None:
    if not is_channel_member(user_id, ch["id"]):
        return
    audience = [*channel_audience(ch), user_id]
    db.delete("channel_members", {"channelId": ch["id"], "userId": user_id})
    publish({"type": "channel.member_removed", "channelId": ch["id"], "userId": user_id}, audience)


def _set_members(ch: dict, ids: list[str]) -> None:
    """The channel's project members become exactly `ids` (Owner/Admin rows are left alone)."""
    allowed = project_member_ids(ch["projectId"])
    # Managers are in every channel of their project (§9.3), so they're never removed.
    want = {i for i in ids if i in allowed} | set(project_managers(ch["projectId"]))
    current = [r["userId"] for r in db.rows("SELECT user_id FROM channel_members WHERE channel_id = %(c)s", c=ch["id"])
               if r["userId"] in allowed]
    for uid in current:
        if uid not in want:
            _remove(ch, uid)
    for uid in want:
        _add(ch, uid)


@router.get("/channels")
def list_channels(user: dict = Depends(current_user)):
    """Every channel the user can read, with unread count, last message and members."""
    candidates = db.rows("""SELECT c.* FROM channels c
                            WHERE c.kind <> 'dm' OR EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = c.id)""")
    # A DM opened but never written in stays invisible, for both people.
    visible = [c for c in candidates if can_see_channel(user, c)]
    for c in visible:
        if c["kind"] not in ("dm", "bot"):
            ensure_channel_member(user["id"], c["id"])  # read markers for Owner/Admin
    stats = channel_stats(user, [c["id"] for c in visible])
    return {"channels": _in_display_order([channel_view(c, user, stats) for c in visible])}


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
def get_channel(channel_id: str, user: dict = Depends(current_user)):
    return channel_view(visible_channel(user, channel_id), user)


@router.get("/projects/{project_id}/channels")
def browse_channels(project_id: str, user: dict = Depends(current_user)):
    """Every channel the user may know about in a project, joined or not (for "Browse channels").
    Guests only see the channels they're in."""
    project = visible_project(user, project_id)
    manager = _manager(user, project["id"])
    on_project = project_member_ids(project["id"])
    out = []
    for c in db.rows("SELECT * FROM channels WHERE project_id = %(p)s", p=project["id"]):
        joined = is_channel_member(user["id"], c["id"])
        if (c["isPrivate"] or is_guest(user)) and not manager and not joined:
            continue
        count = sum(1 for uid in db.rows("SELECT user_id FROM channel_members WHERE channel_id = %(c)s", c=c["id"])
                    if uid["userId"] in on_project)
        out.append({**channel_view(c, user), "memberCount": count})
    return {"channels": sorted(out, key=lambda v: channel_rank(setup(), v))}


@router.post("/projects/{project_id}/channels")
def create_channel(project_id: str, body: ChannelCreate, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_manage(user, project)
    if existing := channel(body.id):
        if existing["projectId"] == project["id"]:
            return {"channel": channel_view(existing, user)}  # a retry
        raise ApiError("VALIDATION_FAILED", "Some fields need attention.", {"fields": {"id": "Already used"}})
    _assert_name_free(project["id"], body.name)
    ch = db.insert("channels", {"id": body.id, "companyId": db.company_id(), "projectId": project["id"], "name": body.name,
                                "kind": "project", "isPrivate": body.isPrivate, "postingPolicy": "everyone",
                                "updatedAt": now_iso()})
    members = {i for i in body.memberIds if i in project_member_ids(project["id"])}
    for uid in [*members, *project_managers(project["id"]), *admins(), user["id"]]:
        _add(ch, uid)
    post_message(ch, BOT_ID, type="system", body=f"{first_name(user['id'])} created #{ch['name']}")
    return {"channel": channel_view(ch, user)}


@router.patch("/channels/{channel_id}")
def patch_channel(channel_id: str, body: ChannelPatch, user: dict = Depends(current_user)):
    ch, project = _project_channel(user, channel_id)
    _require_manage(user, project)
    home = ch["name"] == HOME_CHANNEL
    changes: dict = {}
    if body.name is not None and body.name != ch["name"]:
        if home:
            raise invalid({"name": "#general cannot be renamed"})
        _assert_name_free(project["id"], body.name, ch["id"])
        changes["name"] = body.name
    if body.isPrivate is not None and body.isPrivate != ch["isPrivate"]:
        if home and body.isPrivate:
            raise invalid({"isPrivate": "#general stays open to the whole project"})
        changes["isPrivate"] = body.isPrivate
    ch = db.update("channels", {"id": ch["id"]}, {**changes, "updatedAt": now_iso()})
    if "isPrivate" in changes:
        post_message(ch, BOT_ID, type="system",
                     body=f"{first_name(user['id'])} made this channel {'private' if ch['isPrivate'] else 'public'}")
    if body.memberIds is not None:
        _set_members(ch, body.memberIds)
    publish({"type": "channel.updated", "channel": ch}, [*channel_audience(ch), *project_audience(project["id"])])
    return {"channel": channel_view(ch, user)}


@router.delete("/channels/{channel_id}")
def delete_channel(channel_id: str, user: dict = Depends(current_user)):
    if not channel(channel_id):
        return {"deleted": True}  # already gone: safe to repeat
    ch, project = _project_channel(user, channel_id)
    _require_manage(user, project)
    if ch["name"] == HOME_CHANNEL:
        raise invalid({"name": "#general cannot be deleted"})
    audience = channel_audience(ch)
    db.delete("channels", {"id": ch["id"]})  # its messages and members go with it
    publish({"type": "channel.deleted", "channelId": ch["id"]}, audience)
    return {"deleted": True}


@router.post("/channels/{channel_id}/join")
def join_channel(channel_id: str, user: dict = Depends(current_user)):
    ch = channel(channel_id)
    if not ch or ch["kind"] != "project" or not ch["projectId"]:
        raise not_found("Channel")
    visible_project(user, ch["projectId"])
    if is_guest(user) and not is_channel_member(user["id"], ch["id"]):
        raise not_found("Channel")
    if ch["isPrivate"] and not is_channel_member(user["id"], ch["id"]) and not is_company_admin(user):
        raise ApiError("CHANNEL_PRIVATE", "This channel is private. Ask a manager to add you.")
    _add(ch, user["id"])
    return {"channel": channel_view(ch, user)}


@router.post("/channels/{channel_id}/leave")
def leave_channel(channel_id: str, user: dict = Depends(current_user)):
    ch = channel(channel_id)
    if not ch or ch["kind"] != "project":
        return {"left": True}
    if ch["name"] == HOME_CHANNEL:
        raise invalid({"name": "Everyone stays in #general"})
    if ch["projectId"] and user["id"] in project_managers(ch["projectId"]):
        raise invalid({"name": "Managers stay in every channel"})
    _remove(ch, user["id"])
    return {"left": True}
