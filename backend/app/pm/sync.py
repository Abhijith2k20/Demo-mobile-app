"""Keeping Siteline in step with the PM app (spec §9.3). Three layers: webhooks update the saved copy at
once (apply_event), the bot re-checks a task right before asking (bot.py), and a full sync runs nightly
and when a link is created (full_sync). Project spaces and their PM members come from here."""
from __future__ import annotations

from .. import db
from ..rules import job_title_error, joins_projects
from ..services import projects as spaces
from ..store import person, setup
from . import connector as pm


def full_sync() -> None:
    """Projects, members and tasks from the PM app. Tasks it no longer lists are marked removed."""
    try:
        unmatched: set[str] = set()
        for p in pm.list_projects():
            unmatched |= sync_project(p)
        seen = []
        for t in pm.list_tasks():
            save_task(t)
            seen.append(t["id"])
        gone = db.rows("""UPDATE pm_tasks SET removed_at = now() WHERE removed_at IS NULL AND NOT (pm_task_id = ANY(%(ids)s))
                          RETURNING pm_task_id""", ids=seen)
        tell_open_checkins([r["pmTaskId"] for r in gone])
        db.run("""UPDATE pm_links SET last_sync_at = now(), last_error = NULL,
                  options = jsonb_set(options, '{unmatched}', %(u)s) WHERE company_id = current_company()""",
               u=db.Json(sorted(unmatched)))
    except pm.Unavailable as e:
        db.run("UPDATE pm_links SET last_error = %(e)s WHERE company_id = current_company()", e=str(e)[:300])
        raise


def apply_event(event: dict) -> bool:
    """One webhook from the PM app; an event id seen before changes nothing. Returns False for a repeat."""
    if not db.insert("pm_events", {"companyId": db.company_id(), "eventId": event["id"]}, on_conflict_nothing=True):
        return False
    kind, data = event["type"], event.get("data") or {}
    if kind == "task.deleted":
        remove_task(data["id"])
    elif kind.startswith("task."):
        save_task(data)
    elif kind.startswith(("project.", "member.")):
        project_id = data.get("projectId") or data["id"]
        p = next((x for x in pm.list_projects() if x["id"] == project_id), None)
        if p:
            sync_project(p)
    return True


def save_task(t: dict) -> None:
    """Writes the PM app's version of a task to the saved copy; open check-ins for it refresh if it changed."""
    before = _shown(pm.saved_task(t["id"]))
    db.run("""INSERT INTO pm_tasks (company_id, pm_task_id, pm_project_id, name, planned_start, planned_finish, owner_ref,
                                    owner_user_id, status, percent, pm_updated_at, removed_at)
              VALUES (current_company(), %(id)s, %(p)s, %(n)s, %(s)s, %(f)s, %(o)s, %(u)s, %(st)s, %(pc)s, %(at)s, NULL)
              ON CONFLICT (company_id, pm_task_id) DO UPDATE SET pm_project_id = excluded.pm_project_id, name = excluded.name,
                planned_start = excluded.planned_start, planned_finish = excluded.planned_finish, owner_ref = excluded.owner_ref,
                owner_user_id = excluded.owner_user_id, status = excluded.status, percent = excluded.percent,
                pm_updated_at = excluded.pm_updated_at, removed_at = NULL""",
           id=t["id"], p=t["projectId"], n=t["name"], s=t["plannedStart"], f=t["plannedFinish"], o=t.get("ownerRef"),
           u=pm.match_person(t.get("ownerRef")), st=t["status"], pc=t.get("percent") or 0, at=t.get("updatedAt"))
    if _shown(pm.saved_task(t["id"])) != before:
        tell_open_checkins([t["id"]])


def remove_task(task_id: str) -> None:
    """The PM app no longer has the task; its open check-ins close ("Changed in the PM app")."""
    if db.run("UPDATE pm_tasks SET removed_at = now() WHERE pm_task_id = %(id)s AND removed_at IS NULL", id=task_id):
        tell_open_checkins([task_id])


def _shown(task: dict | None) -> tuple | None:
    """What a check-in card shows of a task (other changes don't need a refresh)."""
    if not task:
        return None
    return tuple(task[k] for k in ("name", "plannedStart", "plannedFinish", "ownerUserId", "status", "percent"))


def tell_open_checkins(task_ids: list[str]) -> None:
    """Phones showing an unanswered check-in for these tasks refresh it at once (due date, %, or closed)."""
    if not task_ids:
        return
    from ..events import publish
    from ..views import checkin_view

    for c in db.rows("SELECT * FROM checkins WHERE task_id = ANY(%(ids)s) AND answer IS NULL", ids=task_ids):
        publish({"type": "checkin.updated", "checkin": checkin_view(c)}, [c["userId"]])


def _job_title(role: str, role_name: str | None) -> str:
    """The PM role name when it's one of the company's job titles (and allowed for the role), else the default."""
    st = setup()
    if role_name and not job_title_error(st, role, role_name):
        return role_name
    if role == "manager":
        return next((jt["name"] for jt in st["jobTitles"] if jt.get("managersOnly")), st["defaultJobTitle"])
    return st["defaultJobTitle"]


def sync_project(p: dict) -> set[str]:
    """One PM project: its space (created, renamed, archived when closed) and its PM members.
    Returns the people the PM app lists who aren't in this company on Siteline."""
    space = db.row("SELECT * FROM projects WHERE pm_project_id = %(p)s", p=p["id"])
    closed = p.get("status") == "closed"
    if not space:
        if closed:
            return set()
        space = spaces.create_space(name=p["name"], client=p.get("client") or "", address=p.get("address") or "",
                                    pm_project_id=p["id"], pm_url=p.get("url"))
    else:
        changes = {k: v for k, v in (("name", p["name"]), ("client", p.get("client") or ""),
                                     ("address", p.get("address") or ""), ("pmUrl", p.get("url"))) if space.get(k) != v}
        if closed != bool(space["archivedAt"]):
            changes["archivedAt"] = db.value("SELECT now()") if closed else None
        if changes:
            db.update("projects", {"id": space["id"]}, changes)
            space = spaces.project_updated(space)
    unmatched: set[str] = set()
    wanted: dict[str, dict] = {}
    for m in pm.list_members(p["id"]):
        uid = pm.match_person(m["ref"])
        if not uid:
            unmatched.add(m["ref"])
        elif joins_projects(person(uid)):
            wanted[uid] = m
    for row in db.rows("SELECT user_id FROM project_members WHERE project_id = %(p)s AND source = 'pm'", p=space["id"]):
        if row["userId"] not in wanted:
            spaces.remove_member(space["id"], row["userId"])
    for uid, m in wanted.items():
        current = db.row("SELECT * FROM project_members WHERE project_id = %(p)s AND user_id = %(u)s", p=space["id"], u=uid)
        title = _job_title(m["role"], m.get("roleName"))
        if not current or current["source"] == "pm" and (current["role"], current["jobTitle"]) != (m["role"], title):
            spaces.save_member(space["id"], uid, m["role"], title, "pm")
    return unmatched
