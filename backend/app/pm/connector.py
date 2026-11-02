"""The only way into a company's PM app (spec §9.3): projects and tasks live there, Siteline reads them
and sends check-in answers back. Each company has a link (`pm_links`): the mock until its real API exists.

Tasks come back as {id, projectId (the PM project), name, plannedStart, plannedFinish, ownerRef (email or
phone), status, percent, updatedAt}."""
from __future__ import annotations

from .. import db
from ..services.secrets import decrypt
from . import mock
from .http import Client
from .mock import Refused, Unavailable

__all__ = ["Refused", "Unavailable", "get_task", "link", "list_members", "list_projects", "list_tasks",
           "owner_of", "project_of", "saved_task", "write_status"]


def link() -> dict | None:
    return db.row("SELECT * FROM pm_links WHERE company_id = current_company()")


def _client():
    lk = link()
    if not lk:
        raise Unavailable("This company isn't linked to a PM app")
    if lk["kind"] == "mock":
        return mock
    return Client(lk["baseUrl"], decrypt(lk["apiKey"]))


def list_projects() -> list[dict]:
    return _client().list_projects()


def list_members(pm_project_id: str) -> list[dict]:
    return _client().list_members(pm_project_id)


def list_tasks(pm_project_id: str | None = None) -> list[dict]:
    return _client().list_tasks(pm_project_id)


def get_task(task_id: str | None) -> dict | None:
    return _client().get_task(task_id) if task_id else None


def write_status(task_id: str, change: dict, key: str) -> dict:
    return _client().write_status(task_id, change, key)


# ---- The saved copy (pm_tasks), and matching PM records to Siteline ----

def saved_task(task_id: str | None) -> dict | None:
    """The task as Siteline last saw it (kept up to date by sync and webhooks); None once removed."""
    if not task_id:
        return None
    t = db.row("SELECT * FROM pm_tasks WHERE pm_task_id = %(id)s AND removed_at IS NULL", id=task_id)
    if not t:
        return None
    return {"id": t["pmTaskId"], "projectId": t["pmProjectId"], "name": t["name"], "plannedStart": t["plannedStart"],
            "plannedFinish": t["plannedFinish"], "ownerRef": t["ownerRef"], "ownerUserId": t["ownerUserId"],
            "status": t["status"], "percent": t["percent"]}


def project_of(task: dict) -> dict | None:
    """The Siteline project space linked to the task's PM project."""
    return db.row("SELECT * FROM projects WHERE pm_project_id = %(p)s", p=task["projectId"])


def match_person(ref: str | None) -> str | None:
    """The active member of this company the PM app means (matched by email or phone)."""
    if not ref:
        return None
    return db.value("""SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id AND m.company_id = current_company()
                       WHERE m.status = 'active' AND u.deleted_at IS NULL
                         AND (lower(u.email) = lower(%(r)s) OR u.phone = %(r)s)""", r=ref)


def owner_of(task: dict) -> str | None:
    return task.get("ownerUserId") or match_person(task.get("ownerRef"))
