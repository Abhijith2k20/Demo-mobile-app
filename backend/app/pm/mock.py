"""A stand-in for a company's PM app (spec §9.3) until its API exists. It keeps projects, members and tasks in
its own tables and answers the same calls as the real API (pm/http.py). Changes made to it (from the platform
panel or the dev panel) are announced the way the real app's webhooks will be: pm/sync.apply_event."""
from __future__ import annotations

from .. import db
from ..core import now_iso, uuid7

OPEN = ("not_started", "in_progress", "blocked")


class Refused(Exception):
    """The PM app said no (the reason is shown to the person)."""


class Unavailable(Exception):
    """The PM app didn't answer; try again later."""


def _check_up() -> None:
    if db.value("SELECT (options->>'down')::boolean FROM pm_links WHERE company_id = current_company()"):
        raise Unavailable("The PM app isn't answering")


def _task(t: dict) -> dict:
    return {"id": t["id"], "projectId": t["projectId"], "name": t["name"], "plannedStart": t["plannedStart"],
            "plannedFinish": t["plannedFinish"], "ownerRef": t["ownerRef"], "status": t["status"], "percent": t["percent"],
            "updatedAt": t["updatedAt"]}


def list_projects() -> list[dict]:
    _check_up()
    return db.rows("SELECT id, name, client, address, status, url, updated_at FROM pm_mock_projects ORDER BY name")


def list_members(project_id: str) -> list[dict]:
    _check_up()
    return db.rows("""SELECT person_ref AS ref, name, role, role_name FROM pm_mock_members
                      WHERE project_id = %(p)s ORDER BY name""", p=project_id)


def list_tasks(project_id: str | None = None) -> list[dict]:
    _check_up()
    q = "SELECT * FROM pm_mock_tasks WHERE deleted_at IS NULL" + (" AND project_id = %(p)s" if project_id else "")
    return [_task(t) for t in db.rows(q + " ORDER BY planned_start, name", p=project_id)]


def get_task(task_id: str) -> dict | None:
    _check_up()
    t = db.row("SELECT * FROM pm_mock_tasks WHERE id = %(id)s AND deleted_at IS NULL", id=task_id)
    return _task(t) if t else None


def write_status(task_id: str, change: dict, key: str) -> dict:
    """`change` is {status, percent?, note?, problem?}. The same `key` twice writes once."""
    _check_up()
    done = db.value("SELECT result FROM pm_mock_writes WHERE key = %(k)s", k=key)
    if done:
        return done
    t = db.row("SELECT * FROM pm_mock_tasks WHERE id = %(id)s AND deleted_at IS NULL", id=task_id)
    if not t:
        raise Refused("This task was removed")
    if t["status"] not in OPEN:
        raise Refused("This task is already closed")
    percent = 100 if change["status"] == "done" else change.get("percent", t["percent"])
    if percent is None:
        percent = t["percent"]
    t = db.update("pm_mock_tasks", {"companyId": t["companyId"], "id": task_id},
                  {"status": change["status"], "percent": percent, "updatedAt": now_iso()})
    result = _task(t)
    db.insert("pm_mock_writes", {"companyId": t["companyId"], "key": key, "result": result})
    return result


# ---- Editing the mock (platform panel, dev panel, seed) ----

def save_task(task: dict) -> dict:
    """Creates or changes a task and sends the matching webhook to Siteline."""
    from . import sync

    company = db.company_id()
    existing = db.row("SELECT * FROM pm_mock_tasks WHERE id = %(id)s", id=task.get("id") or "")
    fields = {k: task[k] for k in ("projectId", "name", "plannedStart", "plannedFinish", "ownerRef", "status", "percent") if k in task}
    if existing:
        t = db.update("pm_mock_tasks", {"companyId": company, "id": existing["id"]}, {**fields, "updatedAt": now_iso()})
    else:
        t = db.insert("pm_mock_tasks", {"companyId": company, "id": task.get("id") or uuid7(), **fields})
    sync.apply_event({"id": uuid7(), "type": "task.updated" if existing else "task.created", "data": _task(t)})
    return _task(t)


def delete_task(task_id: str) -> None:
    from . import sync

    db.run("UPDATE pm_mock_tasks SET deleted_at = now() WHERE id = %(id)s", id=task_id)
    sync.apply_event({"id": uuid7(), "type": "task.deleted", "data": {"id": task_id}})


def set_project_status(project_id: str, status: str) -> None:
    from . import sync

    db.run("UPDATE pm_mock_projects SET status = %(s)s, updated_at = now() WHERE id = %(id)s", s=status, id=project_id)
    sync.apply_event({"id": uuid7(), "type": "project.updated", "data": {"id": project_id}})


def set_down(down: bool) -> None:
    db.run("""UPDATE pm_links SET options = jsonb_set(options, '{down}', to_jsonb(%(d)s::boolean))
              WHERE company_id = current_company()""", d=down)
