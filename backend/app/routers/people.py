"""The company's people (spec §5.10, §5.11, §9.5, §9.6): directory, invites, roles, deactivation."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import config, db
from ..core import ApiError, forbidden, not_found
from ..deps import current_user
from ..events import publish
from ..jobs.queue import enqueue
from ..rules import can_change_role, can_deactivate, can_invite_as, is_company_admin, is_guest
from ..schemas import InviteCreate, RoleChange
from ..services import accounts, integrations
from ..store import company, human_ids, people, person
from ..views import public_user

router = APIRouter(tags=["people"])


@router.get("/users")
def list_users(user: dict = Depends(current_user)):
    """Everyone in the company, deactivated people included (they keep their history). Guests only see the
    people they share a channel with."""
    everyone = people()
    if is_guest(user):
        shared = {r["userId"] for r in db.rows("""SELECT DISTINCT b.user_id FROM channel_members a
                                                  JOIN channel_members b ON b.channel_id = a.channel_id
                                                  WHERE a.user_id = %(u)s""", u=user["id"])}
        everyone = [p for p in everyone if p["id"] in shared or p["id"] == user["id"]]
    return {"users": [public_user(u, user) for u in everyone]}


def _invite_view(i: dict) -> dict:
    return {k: i[k] for k in ("id", "identifier", "name", "role", "channelIds", "createdAt", "expiresAt", "status")} | {
        "invitedBy": (person(i["invitedBy"]) or {}).get("name")}


def _send_invite(invite: dict, inviter: dict) -> None:
    enqueue("send_invite", {"identifier": invite["identifier"], "inviter": inviter["name"], "company": company()["name"],
                            "link": config.APP_LINK})


@router.get("/invites")
def list_invites(user: dict = Depends(current_user)):
    if not is_company_admin(user):
        raise forbidden("Only the owner or an admin can see invites.")
    found = db.rows("""SELECT * FROM invites WHERE company_id = current_company() AND status = 'pending' AND expires_at > now()
                       ORDER BY created_at DESC""")
    return {"invites": [_invite_view(i) for i in found]}


@router.post("/invites")
def invite(body: InviteCreate, user: dict = Depends(current_user)):
    if not can_invite_as(user, body.role):
        raise forbidden("Only the owner can add an admin." if body.role == "admin"
                        else "Only the owner or an admin can invite people.")
    identifier = accounts.normalize_identifier(body.identifier)
    if existing := db.row("SELECT * FROM invites WHERE id = %(id)s AND company_id = current_company()", id=body.id):
        return {"invite": _invite_view(existing)}  # a retry
    account = accounts.user_by_identifier(identifier)
    if account and (m := accounts.membership(account["id"], db.company_id())) and m["status"] == "active":
        raise ApiError("ALREADY_MEMBER", f"Already in {company()['name']}.", {"fields": {"identifier": "Already in the company"}})
    channel_ids = []
    if body.role == "guest":
        found = db.rows("SELECT id FROM channels WHERE id = ANY(%(ids)s) AND kind = 'project'", ids=body.channelIds)
        channel_ids = [r["id"] for r in found]
    pending = db.row("""SELECT * FROM invites WHERE company_id = current_company() AND identifier = %(i)s AND status = 'pending'""",
                     i=identifier)
    if pending:
        row = db.update("invites", {"id": pending["id"]}, {"name": body.name, "role": body.role, "channelIds": channel_ids,
                                                          "expiresAt": _expiry(), "invitedBy": user["id"]})
    else:
        row = db.insert("invites", {"id": body.id, "companyId": db.company_id(), "identifier": identifier, "name": body.name,
                                    "role": body.role, "channelIds": channel_ids, "invitedBy": user["id"], "expiresAt": _expiry()})
    _send_invite(row, user)
    accounts.audit(db.company_id(), user["id"], "invite.sent", identifier, {"role": body.role})
    return {"invite": _invite_view(row)}


def _expiry() -> str:
    return db.value(f"SELECT now() + interval '{config.INVITE_TTL_DAYS} days'")


def _pending(invite_id: str) -> dict:
    i = db.row("SELECT * FROM invites WHERE id = %(id)s AND company_id = current_company() AND status = 'pending'", id=invite_id)
    if not i:
        raise not_found("Invite")
    return i


@router.post("/invites/{invite_id}/resend")
def resend_invite(invite_id: str, user: dict = Depends(current_user)):
    if not is_company_admin(user):
        raise forbidden("Only the owner or an admin can resend invites.")
    i = db.update("invites", {"id": _pending(invite_id)["id"]}, {"expiresAt": _expiry()})
    _send_invite(i, user)
    return {"invite": _invite_view(i)}


@router.delete("/invites/{invite_id}")
def cancel_invite(invite_id: str, user: dict = Depends(current_user)):
    if not is_company_admin(user):
        raise forbidden("Only the owner or an admin can cancel invites.")
    db.run("UPDATE invites SET status = 'cancelled' WHERE id = %(id)s AND company_id = current_company() AND status = 'pending'",
           id=invite_id)
    return {"cancelled": True}


def _target(user_id: str) -> dict:
    target = person(user_id)
    if not target or target["id"] == "siteline-bot":
        raise not_found("Person")
    return target


@router.patch("/users/{user_id}")
def change_role(user_id: str, body: RoleChange, user: dict = Depends(current_user)):
    target = _target(user_id)
    if not can_change_role(user, target, body.role):
        raise forbidden("You can't change this person's role.")
    db.run("UPDATE memberships SET role = %(r)s, updated_at = now() WHERE company_id = current_company() AND user_id = %(u)s",
           r=body.role, u=user_id)
    if body.role == "guest":  # guests leave the company channels
        db.run("""DELETE FROM channel_members WHERE user_id = %(u)s
                  AND channel_id IN (SELECT id FROM channels WHERE kind = 'company')""", u=user_id)
    else:
        accounts.join_company(db.company_id(), user_id, body.role)
    accounts.audit(db.company_id(), user["id"], "member.role", user_id, {"role": body.role})
    updated = person(user_id)
    publish({"type": "user.updated", "user": public_user(updated)}, human_ids())
    return {"user": public_user(updated, user)}


@router.post("/users/{user_id}/deactivate")
def deactivate(user_id: str, user: dict = Depends(current_user)):
    """Archive, never delete: they can't open this company; their messages and history stay. Their other
    companies are not affected."""
    target = _target(user_id)
    if target["isActive"]:
        if not can_deactivate(user, target):
            raise forbidden("You can't deactivate this person.")
        accounts.deactivate_member(target["id"])
        accounts.audit(db.company_id(), user["id"], "member.deactivated", target["id"])
        publish({"type": "user.updated", "user": public_user(person(target["id"]))}, human_ids())
    return {"user": public_user(person(target["id"]), user)}


@router.get("/integration")
def integration(user: dict = Depends(current_user)):
    """The PM link's status for the Owner and Admins (§5.12). The link itself is set by the Siteline team."""
    if not is_company_admin(user):
        raise forbidden()
    lk = integrations.current()
    if not lk:
        return {"connected": False}
    return {"connected": True, "kind": lk["kind"], "lastCallAt": lk["lastCallAt"], "lastError": lk["lastError"],
            "unmatched": integrations.unmatched()}
