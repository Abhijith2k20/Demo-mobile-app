"""The only way into the company's PM app (spec §9.3): projects and tasks live there, Siteline reads them
and sends check-in answers back. Swapping the mock for the real API changes this file only.

Tasks come back as {id, projectId (the PM project), name, plannedStart, plannedFinish, ownerRef (email),
status, percent, updatedAt}."""
from __future__ import annotations

from ..store import S
from . import mock
from .mock import Refused

__all__ = ["Refused", "get_task", "list_tasks", "owner_of", "project_of", "write_status"]

# shortcut: one company, always the mock; per-company links (`pm_links`) come with Postgres (build step 5).
_pm = mock


def list_tasks(pm_project_id: str | None = None, owner_ref: str | None = None) -> list[dict]:
    return _pm.list_tasks(pm_project_id, owner_ref)


def get_task(task_id: str | None) -> dict | None:
    return _pm.get_task(task_id) if task_id else None


def write_status(task_id: str, change: dict, key: str) -> dict:
    return _pm.write_status(task_id, change, key)


# ---- Matching PM records to Siteline ----

def project_of(task: dict) -> dict | None:
    """The Siteline project space linked to the task's PM project."""
    return next((p for p in S().projects.values() if p.get("pmProjectId") == task["projectId"]), None)


def owner_of(task: dict) -> str | None:
    """The active Siteline person the PM app names as owner (matched by email)."""
    ref = (task.get("ownerRef") or "").lower()
    return next((u["id"] for u in S().users.values() if ref and u["isActive"] and u["email"].lower() == ref), None)
