"""Projects (spec §5.6, §5.13): groups of channels for conversation. The Owner and Admins create, edit, archive
and delete them and add people; being on a project lets a person see it and browse its channels."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db
from ..access import assert_project_active, can_see_channel, can_see_project, project_audience, visible_project
from ..core import forbidden, invalid, not_found, now_iso
from ..deps import current_user
from ..events import publish
from ..rules import can, company_permissions, is_company_admin, joins_projects
from ..schemas import MemberAdd, MemberPatch, ProjectCreate, ProjectPatch
from ..services import projects as spaces
from ..services.messaging import post_message
from ..store import BOT_ID, MESSAGE_COLUMNS, first_name, person, project_channel, project_channels, project_member
from ..views import project_view, with_links

router = APIRouter(tags=["projects"])


def _require_manage(user: dict) -> None:
    if not can(user, "project.manage"):
        raise forbidden("Only the owner or an admin can manage projects.")


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
    if "project.create" not in company_permissions(user):
        raise forbidden("Only the owner or an admin can create projects.")
    if existing := db.row("SELECT * FROM projects WHERE id = %(id)s", id=body.id):
        return project_view(existing, user)  # a retry (Owner/Admin see every project anyway)
    return project_view(spaces.create_space(creator_id=user["id"], id=body.id, name=body.name, client=body.client,
                                            address=body.address), user)


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatch, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_manage(user)
    fields = body.model_dump(exclude_unset=True)
    archived = fields.pop("archived", None)
    if archived is not None and archived != bool(project["archivedAt"]):
        project = db.update("projects", {"id": project["id"]}, {"archivedAt": now_iso() if archived else None})
        project = spaces.project_updated(project)
        if home := project_channel(project["id"], "general"):
            post_message(home, BOT_ID, type="system",
                         body=f"{first_name(user['id'])} {'archived' if archived else 'unarchived'} this project")
    if fields:
        assert_project_active(project["id"])
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
    db.delete("projects", {"id": project["id"]})  # channels, messages and members go with it
    publish({"type": "project.deleted", "projectId": project["id"]}, audience)
    return {"deleted": True}


def _set_channels(project_id: str, user_id: str, channel_ids: list[str]) -> None:
    """The person's channels in this project become exactly `channel_ids`."""
    for ch in project_channels(project_id):
        if ch["id"] in channel_ids:
            spaces.add_to_channel(ch, user_id)
        else:
            spaces.remove_from_channel(ch, user_id)


@router.post("/projects/{project_id}/members")
def add_member(project_id: str, body: MemberAdd, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_manage(user)
    assert_project_active(project["id"])
    target = person(body.userId)
    if not target or not target["isActive"]:
        raise not_found("Person")
    if not joins_projects(target):
        raise invalid({"userId": "The owner and admins already see every project"})
    spaces.add_member(project["id"], target["id"])  # joins every public channel
    for ch in project_channels(project["id"]):
        if ch["id"] in body.channelIds:  # plus any private ones picked
            spaces.add_to_channel(ch, target["id"])
    spaces.project_updated(project)
    return {"projectId": project["id"], "userId": target["id"]}


@router.patch("/projects/{project_id}/members/{user_id}")
def patch_member(project_id: str, user_id: str, body: MemberPatch, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_manage(user)
    assert_project_active(project["id"])
    if not project_member(user_id, project["id"]):
        raise not_found("Member")
    _set_channels(project["id"], user_id, body.channelIds)
    spaces.project_updated(project)
    return {"projectId": project["id"], "userId": user_id}


@router.delete("/projects/{project_id}/members/{user_id}")
def remove_member(project_id: str, user_id: str, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_manage(user)
    if project_member(user_id, project["id"]):
        spaces.remove_member(project["id"], user_id)
        spaces.project_updated(project)
    return {"removed": True}  # already gone: safe to repeat


@router.get("/projects/{project_id}/files")
def project_files(project_id: str, user: dict = Depends(current_user)):
    """Every photo and file posted in the project's channels the user can read, newest first."""
    project = visible_project(user, project_id)
    channels = [c["id"] for c in project_channels(project["id"]) if can_see_channel(user, c)]
    files = []
    for m in db.rows(f"""SELECT {MESSAGE_COLUMNS} FROM messages m WHERE channel_id = ANY(%(ids)s) AND deleted_at IS NULL
                         AND type IN ('image', 'file') ORDER BY created_at DESC LIMIT 400""", ids=channels):
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
