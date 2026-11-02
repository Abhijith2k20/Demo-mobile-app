"""Project spaces (spec §5.6, §5.13): their members, recent updates, files, and the PM app's tasks (read-only).
Projects linked to the PM app get their name, archive state and members from it (pm/sync.py); here a
Manager only changes who is in which channel and adds or removes guests."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db
from ..core import ApiError, forbidden, invalid, not_found, now_iso
from ..deps import current_user
from ..events import publish
from ..rules import can, company_permissions, is_company_admin, is_guest, job_title_error, joins_projects
from ..schemas import MemberAdd, MemberPatch, ProjectCreate, ProjectPatch
from ..access import can_see_channel, assert_project_active, can_see_project, project_audience, visible_project
from ..store import BOT_ID, MESSAGE_COLUMNS, first_name, person, project_channel, project_channels, project_member, project_role, setup
from ..pm import connector as pm
from ..services import projects as spaces
from ..views import message_view, pm_task_view, project_view, with_links
from ..services.messaging import post_message

router = APIRouter(tags=["projects"])

LINKED = "This project's people come from the PM app. Change them there."


def _require_members(user: dict, project: dict) -> None:
    if not can(user, "project.members", project_role(user["id"], project["id"])):
        raise forbidden("Only managers can manage members.")


@router.get("/projects")
def list_projects(user: dict = Depends(current_user)):
    if is_company_admin(user):
        visible = db.rows("SELECT * FROM projects ORDER BY name")
    else:
        visible = db.rows("""SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id
                             WHERE m.user_id = %(u)s ORDER BY p.name""", u=user["id"])
    return {"projects": [project_view(p, user) for p in visible]}


@router.get("/projects/{project_id}")
def get_project(project_id: str, user: dict = Depends(current_user)):
    return project_view(visible_project(user, project_id), user)


@router.post("/projects")
def create_project(body: ProjectCreate, user: dict = Depends(current_user)):
    """Only for companies without a PM link: linked companies get their projects from the PM app."""
    if "project.create" not in company_permissions(user):
        raise forbidden("Only the owner or an admin can create projects.")
    if existing := db.row("SELECT * FROM projects WHERE id = %(id)s", id=body.id):
        return project_view(existing, user)  # a retry (Owner/Admin see every project anyway)
    if pm.link():
        raise ApiError("PROJECT_LINKED", "Projects come from the PM app. Create it there.")
    return project_view(spaces.create_space(id=body.id, name=body.name, client=body.client, address=body.address), user)


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatch, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    role = project_role(user["id"], project["id"])
    fields = body.model_dump(exclude_unset=True)
    archived = fields.pop("archived", None)
    linked = bool(project["pmProjectId"])
    if linked and (fields or archived is not None):
        raise ApiError("PROJECT_LINKED", "This project's details come from the PM app. Change them there.")
    if archived is not None and archived != bool(project["archivedAt"]):
        if not can(user, "project.edit", role):
            raise forbidden("Only managers can archive a project.")
        project = db.update("projects", {"id": project["id"]}, {"archivedAt": now_iso() if archived else None})
        project = spaces.project_updated(project)
        if home := project_channel(project["id"], "general"):
            post_message(home, BOT_ID, type="system",
                         body=f"{first_name(user['id'])} {'archived' if archived else 'unarchived'} this project")
    if project["archivedAt"] and fields:
        assert_project_active(project["id"])
    if fields:
        if not can(user, "project.edit", role):
            raise forbidden("Only managers can edit project details.")
        db.update("projects", {"id": project["id"]}, fields)
        project = spaces.project_updated(project)
    return project_view(project, user)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, user: dict = Depends(current_user)):
    project = db.row("SELECT * FROM projects WHERE id = %(id)s", id=project_id)
    if not project:
        return {"deleted": True}  # already gone: safe to repeat
    if not can_see_project(user, project["id"]):
        raise not_found("Project")
    if not is_company_admin(user):
        raise forbidden("Only the owner or an admin can delete a project.")
    audience = project_audience(project["id"])
    db.delete("projects", {"id": project["id"]})  # channels, messages, members and check-ins go with it
    publish({"type": "project.deleted", "projectId": project["id"]}, audience)
    return {"deleted": True}


@router.post("/projects/{project_id}/members")
def add_member(project_id: str, body: MemberAdd, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_members(user, project)
    target = person(body.userId)
    if not target or not target["isActive"]:
        raise not_found("Person")
    if not joins_projects(target):
        raise invalid({"userId": "The owner and admins already see every project"})
    if project["pmProjectId"] and not is_guest(target):
        raise ApiError("PROJECT_LINKED", LINKED)
    if is_guest(target) and body.role == "manager":
        raise invalid({"role": "Guests can't be managers"})
    if error := job_title_error(setup(), body.role, body.jobTitle):
        raise invalid({"jobTitle": error})
    spaces.save_member(project["id"], target["id"], body.role, body.jobTitle,
                       "guest" if is_guest(target) else "manual", body.channelIds)
    spaces.project_updated(project)
    return {"projectId": project["id"], "userId": target["id"], "role": body.role, "jobTitle": body.jobTitle}


@router.patch("/projects/{project_id}/members/{user_id}")
def patch_member(project_id: str, user_id: str, body: MemberPatch, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_members(user, project)
    member = project_member(user_id, project["id"])
    if not member:
        raise not_found("Member")
    from_pm = member["source"] == "pm"
    if from_pm and (body.role or body.jobTitle):
        raise ApiError("PROJECT_LINKED", LINKED)
    role, title = body.role or member["role"], body.jobTitle or member["jobTitle"]
    if role == "member" and member["role"] == "manager":
        managers = db.value("SELECT count(*) FROM project_members WHERE project_id = %(p)s AND role = 'manager'", p=project["id"])
        if managers <= 1:
            raise invalid({"role": "A project needs at least one manager"})
    if member["source"] == "guest" and role == "manager":
        raise invalid({"role": "Guests can't be managers"})
    if error := job_title_error(setup(), role, title):
        raise invalid({"jobTitle": error})
    if (role, title) != (member["role"], member["jobTitle"]):
        db.update("project_members", {"projectId": project["id"], "userId": user_id}, {"role": role, "jobTitle": title})
    if role == "manager":
        spaces.set_member_channels(project["id"], user_id, [c["id"] for c in project_channels(project["id"])])
    elif body.channelIds is not None:
        spaces.set_member_channels(project["id"], user_id, body.channelIds)
    spaces.project_updated(project)
    return {"projectId": project["id"], "userId": user_id, "role": role, "jobTitle": title}


@router.delete("/projects/{project_id}/members/{user_id}")
def remove_member(project_id: str, user_id: str, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_members(user, project)
    member = project_member(user_id, project["id"])
    if not member:
        return {"removed": True}  # already gone: safe to repeat
    if member["source"] == "pm":
        raise ApiError("PROJECT_LINKED", LINKED)
    spaces.remove_member(project["id"], user_id)
    spaces.project_updated(project)
    return {"removed": True}


@router.get("/projects/{project_id}/tasks")
def project_tasks(project_id: str, user: dict = Depends(current_user)):
    """The project's open tasks as the PM app has them, read-only (for "Related task" in Report issue)."""
    project = visible_project(user, project_id)
    if not project["pmProjectId"]:
        return {"tasks": []}
    tasks = db.rows("""SELECT pm_task_id FROM pm_tasks WHERE pm_project_id = %(p)s AND removed_at IS NULL
                       AND status <> 'done' ORDER BY planned_start, name""", p=project["pmProjectId"])
    return {"tasks": [pm_task_view(pm.saved_task(t["pmTaskId"])) for t in tasks]}


@router.get("/projects/{project_id}/updates")
def project_updates(project_id: str, user: dict = Depends(current_user)):
    """The last few status cards (check-in results, escalations) across the project's channels."""
    project = visible_project(user, project_id)
    channels = {c["id"]: c for c in project_channels(project["id"])}
    cards = db.rows(f"""SELECT {MESSAGE_COLUMNS} FROM messages m WHERE channel_id = ANY(%(ids)s) AND type = 'status_card'
                        AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5""", ids=list(channels))
    return {"messages": [message_view(m, user, channels[m["channelId"]]) for m in cards]}


@router.get("/projects/{project_id}/files")
def project_files(project_id: str, user: dict = Depends(current_user)):
    """Every photo and file posted in the project's channels the user can read, newest first."""
    project = visible_project(user, project_id)
    channels = [c["id"] for c in project_channels(project["id"]) if can_see_channel(user, c)]
    files = []
    for m in db.rows(f"""SELECT {MESSAGE_COLUMNS} FROM messages m WHERE channel_id = ANY(%(ids)s) AND deleted_at IS NULL
                         AND type IN ('image', 'file', 'issue_card', 'daily_report') ORDER BY created_at DESC LIMIT 400""",
                     ids=channels):
        m = with_links(m)
        if m["type"] == "file":
            files.append({"key": m["id"], "kind": "file", "name": str((m["data"] or {}).get("name", "File")),
                          "uri": (m["data"] or {}).get("uri"), "at": m["createdAt"], "senderId": m["senderId"]})
            continue
        for a in (m["data"] or {}).get("attachments", []) or []:
            files.append({"key": f"{m['id']}-{a['id']}", "kind": "photo", "photo": a, "at": m["createdAt"],
                          "senderId": m["senderId"]})
        if len(files) >= 200:
            break
    return {"files": files}
