"""The mock PM app's own data: projects, members and tasks in `pm_mock_*` tables, edited on the platform panel.
Only the mock reads these; Siteline itself never sees them (it only gets cards and projects through the Cards
API, like from a real PM app)."""
from __future__ import annotations

from .. import db
from ..core import now_iso, uuid7

OPEN = ("not_started", "in_progress", "blocked")


class Refused(Exception):
    """The PM app said no (the reason is shown to the person)."""


class Unavailable(Exception):
    """The PM app didn't answer; try again later."""


def _check_up() -> None:
    if is_down():
        raise Unavailable("The PM app isn't answering")


def _task(t: dict) -> dict:
    return {"id": t["id"], "projectId": t["projectId"], "name": t["name"], "plannedStart": t["plannedStart"],
            "plannedFinish": t["plannedFinish"], "ownerRef": t["ownerRef"], "status": t["status"], "percent": t["percent"],
            "updatedAt": t["updatedAt"]}


def is_down() -> bool:
    """Dev panel / platform panel switch: the mock stops answering, so answers wait and retry."""
    return bool(db.value("SELECT (options->>'down')::boolean FROM integrations WHERE company_id = current_company()"))


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
    """Creates or changes a task; the mock then refreshes or closes any open card about it."""
    from .bot import task_changed

    company = db.company_id()
    existing = db.row("SELECT * FROM pm_mock_tasks WHERE id = %(id)s", id=task.get("id") or "")
    fields = {k: task[k] for k in ("projectId", "name", "plannedStart", "plannedFinish", "ownerRef", "status", "percent") if k in task}
    if existing:
        t = db.update("pm_mock_tasks", {"companyId": company, "id": existing["id"]}, {**fields, "updatedAt": now_iso()})
    else:
        t = db.insert("pm_mock_tasks", {"companyId": company, "id": task.get("id") or uuid7(), **fields})
    task_changed(t["id"])
    return _task(t)


def delete_task(task_id: str) -> None:
    from .bot import task_changed

    db.run("UPDATE pm_mock_tasks SET deleted_at = now() WHERE id = %(id)s", id=task_id)
    task_changed(task_id)


def set_project_status(project_id: str, status: str) -> None:
    from .bot import publish_projects

    db.run("UPDATE pm_mock_projects SET status = %(s)s, updated_at = now() WHERE id = %(id)s", s=status, id=project_id)
    publish_projects()


def set_down(down: bool) -> None:
    db.run("""UPDATE integrations SET options = jsonb_set(options, '{down}', to_jsonb(%(d)s::boolean))
              WHERE company_id = current_company()""", d=down)
