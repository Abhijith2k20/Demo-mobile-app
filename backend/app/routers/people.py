"""The company directory: list, invite, deactivate."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..core import ApiError, avatar_tone, forbidden, not_found, now_iso, uuid7
from ..deps import current_user
from ..events import publish
from ..rules import can_deactivate, can_invite_as
from ..schemas import UserInvite
from ..store import S, humans
from ..views import public_user
from ..services.people import deactivate_user

router = APIRouter(tags=["people"])


@router.get("/users")
async def list_users(user: dict = Depends(current_user)):
    """Everyone in the company, deactivated people included (they keep their history)."""
    s = S()
    people = sorted((u for u in s.users.values() if u["id"] != s.bot_id), key=lambda u: u["name"])
    return {"users": [public_user(u, user) for u in people]}


@router.post("/users")
async def invite_user(body: UserInvite, user: dict = Depends(current_user)):
    s = S()
    if not can_invite_as(user, body.companyRole):
        raise forbidden("Only the owner can add an admin." if body.companyRole == "admin"
                        else "Only the owner or an admin can invite people.")
    if existing := s.users.get(body.id):
        return {"user": public_user(existing, user)}  # a retry (the directory is visible to all)
    if any(u["isActive"] and u["email"] == body.email for u in s.users.values()):
        raise ApiError("EMAIL_TAKEN", "Someone already uses this email.", {"fields": {"email": "Already used"}})
    ts = now_iso()
    invited = {"id": body.id, "name": body.name, "email": body.email, "companyRole": body.companyRole,
               "avatarColor": avatar_tone(body.id), "isActive": True, "updatedAt": ts, "online": False}
    s.users[invited["id"]] = invited
    # Same starting point as everyone else: both company channels and a bot DM.
    for ch in s.channels.values():
        if ch["kind"] == "company":
            s.channel_members.append({"channelId": ch["id"], "userId": invited["id"], "lastReadMessageId": None, "joinedAt": ts})
    bot_dm = {"id": uuid7(), "companyId": s.company_id, "projectId": None, "name": "Siteline Bot", "kind": "bot",
              "isPrivate": True, "postingPolicy": "everyone", "updatedAt": ts}
    s.channels[bot_dm["id"]] = bot_dm
    s.channel_members.append({"channelId": bot_dm["id"], "userId": invited["id"], "lastReadMessageId": None, "joinedAt": ts})
    publish({"type": "user.updated", "user": public_user(invited)}, [u["id"] for u in humans()])
    return {"user": public_user(invited, user)}


@router.post("/users/{user_id}/deactivate")
async def deactivate(user_id: str, user: dict = Depends(current_user)):
    """Archive, never delete: they can't sign in, their messages and history stay under their name."""
    s = S()
    target = s.users.get(user_id)
    if not target or target["id"] == s.bot_id:
        raise not_found("Person")
    if target["isActive"]:
        if not can_deactivate(user, target):
            raise forbidden("You can't deactivate this person.")
        deactivate_user(target["id"])
        publish({"type": "user.updated", "user": public_user(target)}, [u["id"] for u in humans()])
    return {"user": public_user(target, user)}
