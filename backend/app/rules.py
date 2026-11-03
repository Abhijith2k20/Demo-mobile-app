"""Business rules. The server is the only place they live: the app just shows the results."""
from __future__ import annotations

# ---- Permissions (spec §9) ----
# Projects have no roles of their own: the Owner and Admins run projects and channels (spec 2.2).

PROJECT_ACTIONS = ["project.manage", "channel.manage", "message.delete_any", "message.pin"]

EDIT_WINDOW_MS = 15 * 60 * 1000
DELETE_WINDOW_MS = 60 * 60 * 1000
HOME_CHANNEL = "general"


def is_company_admin(user: dict) -> bool:
    return user["companyRole"] in ("owner", "admin")


def joins_projects(user: dict) -> bool:
    """Owner and Admins already see every project, so they are never added as project members."""
    return not is_company_admin(user)


def can(user: dict, action: str) -> bool:
    return is_company_admin(user) and action in PROJECT_ACTIONS


def project_permissions(user: dict, archived: bool) -> list[str]:
    """What the user may do in a project right now. An archived project is read-only, but can still be
    unarchived or deleted."""
    if not is_company_admin(user):
        return []
    lifecycle = ["project.archive", "project.delete"]
    return lifecycle if archived else PROJECT_ACTIONS + lifecycle


def is_guest(user: dict) -> bool:
    """Clients, architects, subcontractors: only the channels they were given (spec §9.1)."""
    return user["companyRole"] == "guest"


COMPANY_PERMISSIONS = {
    "owner": ["company.people", "company.directory", "user.invite", "user.invite_admin", "user.role", "project.create",
              "pm.status"],
    "admin": ["company.people", "company.directory", "user.invite", "user.role", "project.create", "pm.status"],
    "member": ["company.directory"],
    "guest": [],
}
ROLE_RANK = {"owner": 3, "admin": 2, "member": 1, "guest": 0}


def company_permissions(user: dict) -> list[str]:
    return list(COMPANY_PERMISSIONS.get(user["companyRole"], []))


def can_invite_as(user: dict, role: str) -> bool:
    """The Owner invites Admins, Members and Guests; Admins invite Members and Guests."""
    if role == "owner":
        return False
    return user["companyRole"] == "owner" if role == "admin" else is_company_admin(user)


def can_deactivate(actor: dict, target: dict) -> bool:
    """Nobody deactivates themselves or the Owner; an Admin can deactivate Members and Guests."""
    if actor["id"] == target["id"] or target["companyRole"] == "owner":
        return False
    if actor["companyRole"] == "owner":
        return True
    return actor["companyRole"] == "admin" and target["companyRole"] in ("member", "guest")


def can_change_role(actor: dict, target: dict, role: str) -> bool:
    """The Owner sets Admin, Member or Guest; Admins move people between Member and Guest. Ownership
    moves only through the Siteline team, and nobody changes their own role."""
    if actor["id"] == target["id"] or target["companyRole"] == "owner" or role == "owner":
        return False
    if actor["companyRole"] == "owner":
        return True
    return actor["companyRole"] == "admin" and target["companyRole"] in ("member", "guest") and role in ("member", "guest")


def can_post(user: dict, channel: dict) -> bool:
    if channel["kind"] == "bot":
        return False
    if channel["postingPolicy"] == "admins":
        return is_company_admin(user)
    return True
