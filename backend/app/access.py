"""Who may see and change what. Every route and the event hub go through these, so a hidden
record is a 404 (never a 403) and events only reach people allowed to see them."""
from __future__ import annotations

from .core import ApiError, not_found
from .rules import is_company_admin
from .store import S, admins, channel_member_ids, humans, is_channel_member, project_member_ids, project_role


def can_see_project(user: dict, project_id: str) -> bool:
    return is_company_admin(user) or project_role(user["id"], project_id) is not None


def can_see_channel(user: dict, ch: dict) -> bool:
    if ch["kind"] in ("dm", "bot"):
        return is_channel_member(user["id"], ch["id"])
    if ch["kind"] == "company":
        return True
    return is_company_admin(user) or is_channel_member(user["id"], ch["id"])


def channel_audience(ch: dict) -> list[str]:
    members = channel_member_ids(ch["id"])
    if ch["kind"] in ("dm", "bot"):
        return members
    if ch["kind"] == "company":
        return [u["id"] for u in humans()]
    return list({*members, *admins()})


def project_audience(project_id: str) -> list[str]:
    return list({*project_member_ids(project_id), *admins()})


def visible_project(user: dict, project_id: str) -> dict:
    """The project, or a 404 when hidden (hidden resources are never a 403)."""
    p = S().projects.get(project_id)
    if not p or not can_see_project(user, project_id):
        raise not_found("Project")
    return p


def visible_channel(user: dict, channel_id: str) -> dict:
    ch = S().channels.get(channel_id)
    if not ch or not can_see_channel(user, ch):
        raise not_found("Channel")
    return ch


def visible_task(user: dict, task_id: str) -> dict:
    t = S().tasks.get(task_id)
    if not t or t["deletedAt"] or not can_see_project(user, t["projectId"]):
        raise not_found("Task")
    return t


def assert_project_active(project_id: str | None) -> None:
    if project_id and (p := S().projects.get(project_id)) and p["archivedAt"]:
        raise ApiError("PROJECT_ARCHIVED", "This project is archived. Unarchive it to make changes.")
