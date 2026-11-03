"""Projects and their people (spec §5.13). A project is a group of channels for conversation: the Owner and
Admins make it, and add people to it and to its channels. Nobody is added to anything automatically."""
from __future__ import annotations

from .. import db
from ..access import channel_audience, project_audience
from ..core import now_iso, uuid7
from ..events import publish
from ..rules import HOME_CHANNEL, joins_projects
from ..store import add_channel_member, admins, person, project, project_channels


def create_space(*, creator_id: str, id: str | None = None, name: str, client: str = "", address: str = "") -> dict:
    """The project with its #general, holding only its creator."""
    p = db.insert("projects", {"id": id or uuid7(), "companyId": db.company_id(), "name": name, "client": client,
                               "address": address, "archivedAt": None, "updatedAt": now_iso()})
    general = db.insert("channels", {"id": uuid7(), "companyId": db.company_id(), "projectId": p["id"], "name": HOME_CHANNEL,
                                     "kind": "project", "isPrivate": False, "postingPolicy": "everyone"})
    add_channel_member(general["id"], creator_id)
    publish({"type": "project.updated", "project": p}, admins())
    return p


def project_updated(p: dict) -> dict:
    p = db.update("projects", {"id": p["id"]}, {"updatedAt": now_iso()})
    publish({"type": "project.updated", "project": p}, project_audience(p["id"]))
    return p


def add_member(project_id: str, user_id: str) -> None:
    """Puts the person on the project (they can see it and browse its channels). The Owner and Admins see every
    project already, so they aren't listed."""
    if joins_projects(person(user_id)):
        db.insert("project_members", {"companyId": db.company_id(), "projectId": project_id, "userId": user_id,
                                      "joinedAt": now_iso()}, on_conflict_nothing=True)


def add_to_channel(ch: dict, user_id: str) -> None:
    """Adding someone to a project channel also puts them on its project."""
    if ch["projectId"]:
        add_member(ch["projectId"], user_id)
    if add_channel_member(ch["id"], user_id):
        publish({"type": "channel.member_added", "channelId": ch["id"], "userId": user_id}, [*channel_audience(ch), user_id])


def remove_from_channel(ch: dict, user_id: str) -> None:
    audience = [*channel_audience(ch), user_id]
    if db.delete("channel_members", {"channelId": ch["id"], "userId": user_id}):
        publish({"type": "channel.member_removed", "channelId": ch["id"], "userId": user_id}, audience)


def remove_member(project_id: str, user_id: str) -> None:
    """Off the project and all its channels; their messages stay."""
    db.delete("project_members", {"projectId": project_id, "userId": user_id})
    for ch in project_channels(project_id):
        remove_from_channel(ch, user_id)
    publish({"type": "project.updated", "project": project(project_id)}, [user_id])
