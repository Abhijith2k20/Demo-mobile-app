"""Project spaces and their people, shared by the project routes and the PM sync."""
from __future__ import annotations

from .. import db
from ..core import now_iso, uuid7
from ..events import publish
from ..access import channel_audience, project_audience
from ..rules import ROLES_IN_EVERY_CHANNEL, default_channel_names, is_company_admin, job_title_error, joins_projects
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


# ---- Projects the PM app sends (PUT /api/v1/projects/{ref}) ----

def _job_title(role: str, role_name: str | None) -> str:
    """The PM role name when it's one of the company's job titles (and allowed for the role), else the default."""
    st = setup()
    if role_name and not job_title_error(st, role, role_name):
        return role_name
    if role == "manager":
        return next((jt["name"] for jt in st["jobTitles"] if jt.get("managersOnly")), st["defaultJobTitle"])
    return st["defaultJobTitle"]


def apply_pm_project(ref: str, p: dict) -> tuple[dict | None, list[str]]:
    """Creates or updates the project space for a PM project (renamed, archived when closed) and makes its PM
    members exactly `p["members"]`; guests and manual members added in Siteline stay. Returns the space and
    the refs the PM app named who aren't in this company on Siteline."""
    from .cards import person_for_ref
    from ..core import ApiError

    space = db.row("SELECT * FROM projects WHERE pm_project_id = %(p)s", p=ref)
    closed = p.get("status") == "closed"
    if not space:
        if closed:
            return None, []
        space = create_space(name=p["name"], client=p.get("client") or "", address=p.get("address") or "",
                             pm_project_id=ref, pm_url=p.get("url"))
    else:
        changes = {k: v for k, v in (("name", p["name"]), ("client", p.get("client") or ""),
                                     ("address", p.get("address") or ""), ("pmUrl", p.get("url"))) if space.get(k) != v}
        if closed != bool(space["archivedAt"]):
            changes["archivedAt"] = now_iso() if closed else None
        if changes:
            db.update("projects", {"id": space["id"]}, changes)
            space = project_updated(space)
    if p.get("members") is None:  # closing a project keeps its members
        return space, []
    unmatched: list[str] = []
    wanted: dict[str, dict] = {}
    for m in p["members"]:
        try:
            uid = person_for_ref(m["ref"])["id"]
        except ApiError:
            unmatched.append(m["ref"])
            continue
        if joins_projects(person(uid)):
            wanted[uid] = m
    for row in db.rows("SELECT user_id FROM project_members WHERE project_id = %(p)s AND source = 'pm'", p=space["id"]):
        if row["userId"] not in wanted:
            remove_member(space["id"], row["userId"])
    for uid, m in wanted.items():
        current = db.row("SELECT * FROM project_members WHERE project_id = %(p)s AND user_id = %(u)s", p=space["id"], u=uid)
        title = _job_title(m["role"], m.get("roleName"))
        if not current or current["source"] == "pm" and (current["role"], current["jobTitle"]) != (m["role"], title):
            save_member(space["id"], uid, m["role"], title, "pm")
    return space, sorted(set(unmatched))

