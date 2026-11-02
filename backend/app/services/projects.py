"""Project spaces and their people, shared by the project routes and the PM sync."""
from __future__ import annotations

from .. import db
from ..core import now_iso, uuid7
from ..events import publish
from ..access import channel_audience, project_audience
from ..rules import ROLES_IN_EVERY_CHANNEL, default_channel_names, is_company_admin
from ..store import admins, add_channel_member, person, project, project_channels, setup


def create_space(*, id: str | None = None, name: str, client: str = "", address: str = "", pm_project_id: str | None = None,
                 pm_url: str | None = None) -> dict:
    """A project space with the company's standard channels; Owner and Admins are in each of them."""
    project = db.insert("projects", {"id": id or uuid7(), "companyId": db.company_id(), "pmProjectId": pm_project_id,
                                     "name": name, "client": client, "address": address, "pmUrl": pm_url,
                                     "archivedAt": None, "updatedAt": now_iso()})
    for std in setup()["projectChannels"]:
        ch = db.insert("channels", {"id": uuid7(), "companyId": db.company_id(), "projectId": project["id"],
                                    "name": std["name"], "kind": "project", "isPrivate": std.get("private", False),
                                    "postingPolicy": "everyone"})
        for admin_id in admins():
            add_channel_member(ch["id"], admin_id)
    publish({"type": "project.updated", "project": project}, admins())
    return project


def project_updated(project: dict) -> dict:
    project = db.update("projects", {"id": project["id"]}, {"updatedAt": now_iso()})
    publish({"type": "project.updated", "project": project}, project_audience(project["id"]))
    return project


def set_member_channels(project_id: str, user_id: str, channel_ids: list[str]) -> None:
    """The person's channels inside the project become exactly `channel_ids` (Owner/Admin keep theirs)."""
    u = person(user_id)
    keeps_access = bool(u) and is_company_admin(u)
    for ch in project_channels(project_id):
        joined = bool(db.value("SELECT 1 FROM channel_members WHERE channel_id = %(c)s AND user_id = %(u)s", c=ch["id"], u=user_id))
        want = ch["id"] in channel_ids
        if want and not joined:
            add_channel_member(ch["id"], user_id)
            publish({"type": "channel.member_added", "channelId": ch["id"], "userId": user_id}, [*channel_audience(ch), user_id])
        elif not want and joined and not keeps_access:
            audience = [*channel_audience(ch), user_id]
            db.delete("channel_members", {"channelId": ch["id"], "userId": user_id})
            publish({"type": "channel.member_removed", "channelId": ch["id"], "userId": user_id}, audience)


def save_member(project_id: str, user_id: str, role: str, job_title: str, source: str,
                channel_ids: list[str] | None = None) -> None:
    """Adds or changes a project member. New members get the channels given, or their job title's defaults;
    Managers are in every channel."""
    existing = db.row("SELECT * FROM project_members WHERE project_id = %(p)s AND user_id = %(u)s", p=project_id, u=user_id)
    if existing:
        db.update("project_members", {"projectId": project_id, "userId": user_id}, {"role": role, "jobTitle": job_title})
    else:
        db.insert("project_members", {"companyId": db.company_id(), "projectId": project_id, "userId": user_id, "role": role,
                                      "jobTitle": job_title, "source": source, "joinedAt": now_iso()})
    all_channels = project_channels(project_id)
    if role in ROLES_IN_EVERY_CHANNEL:
        set_member_channels(project_id, user_id, [c["id"] for c in all_channels])
    elif channel_ids:
        valid = {c["id"] for c in all_channels}
        set_member_channels(project_id, user_id, [c for c in channel_ids if c in valid])
    elif not existing:
        names = default_channel_names(setup(), role, job_title)
        set_member_channels(project_id, user_id, [c["id"] for c in all_channels if c["name"] in names])


def remove_member(project_id: str, user_id: str) -> None:
    db.delete("project_members", {"projectId": project_id, "userId": user_id})
    set_member_channels(project_id, user_id, [])  # access ends; their messages stay
    publish({"type": "project.updated", "project": project(project_id)}, [user_id])
