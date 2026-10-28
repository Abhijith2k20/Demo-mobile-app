"""Projects, their members, recent updates and files."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..core import forbidden, invalid, not_found, now_iso, uuid7
from ..deps import current_user
from ..events import publish
from ..rules import (
    ROLES_IN_EVERY_CHANNEL,
    can,
    company_permissions,
    default_channel_names,
    is_company_admin,
    job_title_error,
    joins_projects,
    localized,
    stage_keys,
    today_iso,
)
from ..schemas import MemberAdd, MemberPatch, ProjectCreate, ProjectPatch
from ..access import (
    can_see_channel,
    assert_project_active,
    can_see_project,
    channel_audience,
    project_audience,
    visible_project,
)
from ..store import S, admins, first_name, project_channel, project_channels, project_role, setup
from ..views import message_view, project_view
from ..services.messaging import post_message

router = APIRouter(tags=["projects"])


def _require_members(user: dict, project: dict) -> None:
    if not can(user, "project.members", project_role(user["id"], project["id"])):
        raise forbidden("Only managers can manage members.")


def set_member_channels(project_id: str, user_id: str, channel_ids: list[str]) -> None:
    """The person's channels inside the project become exactly `channel_ids`."""
    s = S()
    u = s.users.get(user_id)
    keeps_access = bool(u) and is_company_admin(u)
    for ch in project_channels(project_id):
        row = next((m for m in s.channel_members if m["channelId"] == ch["id"] and m["userId"] == user_id), None)
        want = ch["id"] in channel_ids
        if want and not row:
            s.channel_members.append({"channelId": ch["id"], "userId": user_id, "lastReadMessageId": None, "joinedAt": now_iso()})
            publish({"type": "channel.member_added", "channelId": ch["id"], "userId": user_id}, [*channel_audience(ch), user_id])
        elif not want and row and not keeps_access:
            audience = [*channel_audience(ch), user_id]
            s.channel_members.remove(row)
            publish({"type": "channel.member_removed", "channelId": ch["id"], "userId": user_id}, audience)


def _stage_label(key: str) -> str:
    return next(localized(st["label"], "en") for st in setup()["stages"] if st["key"] == key)


def _project_updated(project: dict) -> None:
    project["updatedAt"] = now_iso()
    publish({"type": "project.updated", "project": project}, project_audience(project["id"]))


@router.get("/projects")
async def list_projects(user: dict = Depends(current_user)):
    visible = [p for p in S().projects.values() if can_see_project(user, p["id"])]
    return {"projects": [project_view(p, user) for p in sorted(visible, key=lambda p: p["name"])]}


@router.get("/projects/{project_id}")
async def get_project(project_id: str, user: dict = Depends(current_user)):
    return project_view(visible_project(user, project_id), user)


@router.post("/projects")
async def create_project(body: ProjectCreate, user: dict = Depends(current_user)):
    s = S()
    if "project.create" not in company_permissions(user):
        raise forbidden("Only the owner or an admin can create projects.")
    if existing := s.projects.get(body.id):
        return project_view(existing, user)  # a retry (Owner/Admin see every project anyway)
    ts = now_iso()
    project = {
        "id": body.id, "companyId": s.company_id, "name": body.name, "client": body.client, "address": body.address,
        "stage": stage_keys(setup())[0], "startDate": today_iso(), "plannedFinish": today_iso(), "baselineFinish": None,
        "baselineLocked": False, "archivedAt": None, "updatedAt": ts,
    }
    s.projects[project["id"]] = project
    for std in setup()["projectChannels"]:
        ch = {"id": uuid7(), "companyId": s.company_id, "projectId": project["id"], "name": std["name"], "kind": "project",
              "isPrivate": std.get("private", False), "postingPolicy": "everyone", "updatedAt": ts}
        s.channels[ch["id"]] = ch
        for admin_id in admins():
            s.channel_members.append({"channelId": ch["id"], "userId": admin_id, "lastReadMessageId": None, "joinedAt": ts})
    publish({"type": "project.updated", "project": project}, admins())
    return project_view(project, user)


@router.patch("/projects/{project_id}")
async def patch_project(project_id: str, body: ProjectPatch, user: dict = Depends(current_user)):
    s = S()
    project = visible_project(user, project_id)
    role = project_role(user["id"], project["id"])
    fields = body.model_dump(exclude_unset=True)
    stage = fields.pop("stage", None)
    if stage and stage not in stage_keys(setup()):
        raise invalid({"stage": "Pick one of the company's stages"})
    archived = fields.pop("archived", None)
    if archived is not None and archived != bool(project["archivedAt"]):
        if not can(user, "project.edit", role):
            raise forbidden("Only managers can archive a project.")
        project["archivedAt"] = now_iso() if archived else None
        _project_updated(project)
        if home := project_channel(project["id"], "general"):
            post_message(home, s.bot_id, type="system",
                         body=f"{first_name(user['id'])} {'archived' if archived else 'unarchived'} this project")
    if project["archivedAt"] and (stage or fields):
        assert_project_active(project["id"])
    if fields:
        if not can(user, "project.edit", role):
            raise forbidden("Only managers can edit project details.")
        project.update(fields)
        _project_updated(project)
    if stage and stage != project["stage"]:
        if not can(user, "project.stage", role):
            raise forbidden("Only managers can move the project stage.")
        project["stage"] = stage
        _project_updated(project)
        if general := project_channel(project["id"], "general"):
            post_message(general, s.bot_id, type="system",
                         body=f"{first_name(user['id'])} moved the project to {_stage_label(stage)}")
    return project_view(project, user)


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(current_user)):
    s = S()
    project = s.projects.get(project_id)
    if not project:
        return {"deleted": True}  # already gone: safe to repeat
    if not can_see_project(user, project["id"]):
        raise not_found("Project")
    if not is_company_admin(user):
        raise forbidden("Only the owner or an admin can delete a project.")
    audience = project_audience(project["id"])
    channel_ids = {c["id"] for c in project_channels(project["id"])}
    task_ids = {t["id"] for t in s.tasks.values() if t["projectId"] == project["id"]}
    s.messages = {k: m for k, m in s.messages.items() if m["channelId"] not in channel_ids}
    s.channels = {k: c for k, c in s.channels.items() if k not in channel_ids}
    s.channel_members = [m for m in s.channel_members if m["channelId"] not in channel_ids]
    s.tasks = {k: t for k, t in s.tasks.items() if k not in task_ids}
    s.task_history = [h for h in s.task_history if h["taskId"] not in task_ids]
    s.checkins = {k: c for k, c in s.checkins.items() if c["taskId"] not in task_ids}
    s.project_members = [m for m in s.project_members if m["projectId"] != project["id"]]
    del s.projects[project["id"]]
    publish({"type": "project.deleted", "projectId": project["id"]}, audience)
    return {"deleted": True}


@router.post("/projects/{project_id}/members")
async def add_member(project_id: str, body: MemberAdd, user: dict = Depends(current_user)):
    s = S()
    project = visible_project(user, project_id)
    _require_members(user, project)
    target = s.users.get(body.userId)
    if not target or not target["isActive"] or target["id"] == s.bot_id:
        raise not_found("Person")
    if not joins_projects(target):
        raise invalid({"userId": "The owner and admins already see every project"})
    if error := job_title_error(setup(), body.role, body.jobTitle):
        raise invalid({"jobTitle": error})
    existing = next((m for m in s.project_members if m["projectId"] == project["id"] and m["userId"] == target["id"]), None)
    if existing:
        existing.update(role=body.role, jobTitle=body.jobTitle)
    else:
        s.project_members.append({"projectId": project["id"], "userId": target["id"], "role": body.role,
                                  "jobTitle": body.jobTitle, "joinedAt": now_iso()})
    valid = [c["id"] for c in project_channels(project["id"])]
    channel_ids = [cid for cid in body.channelIds if cid in valid]
    if not channel_ids:
        names = default_channel_names(setup(), body.role, body.jobTitle)
        channel_ids = [c["id"] for c in project_channels(project["id"]) if c["name"] in names]
    if body.role in ROLES_IN_EVERY_CHANNEL:
        channel_ids = valid  # managers are in every channel of the project
    set_member_channels(project["id"], target["id"], channel_ids)
    _project_updated(project)
    return {"projectId": project["id"], "userId": target["id"], "role": body.role, "jobTitle": body.jobTitle}


@router.patch("/projects/{project_id}/members/{user_id}")
async def patch_member(project_id: str, user_id: str, body: MemberPatch, user: dict = Depends(current_user)):
    s = S()
    project = visible_project(user, project_id)
    _require_members(user, project)
    member = next((m for m in s.project_members if m["projectId"] == project["id"] and m["userId"] == user_id), None)
    if not member:
        raise not_found("Member")
    if body.role == "member" and member["role"] == "manager":
        managers = [m for m in s.project_members if m["projectId"] == project["id"] and m["role"] == "manager"]
        if len(managers) <= 1:
            raise invalid({"role": "A project needs at least one manager"})
    if error := job_title_error(setup(), body.role or member["role"], body.jobTitle or member["jobTitle"]):
        raise invalid({"jobTitle": error})
    if body.role:
        member["role"] = body.role
    if body.jobTitle:
        member["jobTitle"] = body.jobTitle
    if member["role"] in ROLES_IN_EVERY_CHANNEL:
        set_member_channels(project["id"], user_id, [c["id"] for c in project_channels(project["id"])])
    elif body.channelIds is not None:
        set_member_channels(project["id"], user_id, body.channelIds)
    _project_updated(project)
    return {"projectId": project["id"], "userId": user_id, "role": member["role"], "jobTitle": member["jobTitle"]}


@router.delete("/projects/{project_id}/members/{user_id}")
async def remove_member(project_id: str, user_id: str, user: dict = Depends(current_user)):
    s = S()
    project = visible_project(user, project_id)
    _require_members(user, project)
    member = next((m for m in s.project_members if m["projectId"] == project["id"] and m["userId"] == user_id), None)
    if not member:
        return {"removed": True}  # already gone: safe to repeat
    s.project_members.remove(member)
    set_member_channels(project["id"], user_id, [])  # access ends; their messages stay
    _project_updated(project)
    publish({"type": "project.updated", "project": project}, [user_id])
    return {"removed": True}


@router.get("/projects/{project_id}/updates")
async def project_updates(project_id: str, user: dict = Depends(current_user)):
    """The last few status cards (check-in results, escalations) across the project's channels."""
    s = S()
    project = visible_project(user, project_id)
    channels = {c["id"]: c for c in project_channels(project["id"])}
    cards = sorted((m for m in s.messages.values() if m["channelId"] in channels and m["type"] == "status_card"
                    and not m["deletedAt"]), key=lambda m: m["createdAt"], reverse=True)[:5]
    return {"messages": [message_view(m, user, channels[m["channelId"]]) for m in cards]}


@router.get("/projects/{project_id}/files")
async def project_files(project_id: str, user: dict = Depends(current_user)):
    """Every photo and file posted in the project's channels the user can read, newest first."""
    s = S()
    project = visible_project(user, project_id)
    channels = {c["id"] for c in project_channels(project["id"]) if can_see_channel(user, c)}
    files = []
    for m in sorted(s.messages.values(), key=lambda m: m["createdAt"], reverse=True):
        if m["channelId"] not in channels or m["deletedAt"] or m["type"] not in ("image", "file", "issue_card", "daily_report"):
            continue
        if m["type"] == "file":
            files.append({"key": m["id"], "kind": "file", "name": str((m["data"] or {}).get("name", "File")),
                          "at": m["createdAt"], "senderId": m["senderId"]})
            continue
        for a in (m["data"] or {}).get("attachments", []) or []:
            files.append({"key": f"{m['id']}-{a['id']}", "kind": "photo", "photo": a, "at": m["createdAt"],
                          "senderId": m["senderId"]})
        if len(files) >= 200:
            break
    return {"files": files}
