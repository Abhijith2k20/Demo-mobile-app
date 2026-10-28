"""Tasks, schedule, baseline and each person's "My tasks"."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..core import ApiError, forbidden, invalid, now_iso, uuid7
from ..deps import current_user
from ..events import publish
from ..notify import add_activity
from ..rules import (
    MEMBER_EDITABLE,
    add_days,
    can,
    current_phase,
    is_done,
    matches_task_filters,
    ordered_phases,
    task_defaults,
    today_iso,
)
from ..schemas import Rebaseline, TaskCreate, TaskPatch
from ..access import (
    assert_project_active,
    can_see_project,
    project_audience,
    visible_project,
    visible_task,
)
from ..store import S, first_name, project_channel, project_member_ids, project_role, setup
from ..views import project_view, task_view
from ..services.messaging import post_message
from ..services.tasks import apply_task_changes, recompute_project, set_baseline

router = APIRouter(tags=["tasks"])


def _require_baseline(user: dict, project: dict) -> None:
    if not can(user, "task.baseline", project_role(user["id"], project["id"])):
        raise forbidden("Only managers can lock the baseline.")


def _project_tasks(project_id: str) -> list[dict]:
    return sorted((t for t in S().tasks.values() if t["projectId"] == project_id and not t["deletedAt"]),
                  key=lambda t: (t["plannedStart"], t["plannedFinish"], t["id"]))


def _csv(value: str) -> list[str]:
    return [v for v in value.split(",") if v]


@router.get("/projects/{project_id}/tasks")
async def list_tasks(
    project_id: str,
    status: str = Query("", description="Comma-separated statuses"),
    owner: str = Query("", description='"me", "unassigned" or a user id'),
    due: str = Query("", description='"overdue", "week" or "month"'),
    delayed: bool = Query(False),
    phase: str = Query("", description="Comma-separated phases"),
    user: dict = Depends(current_user),
):
    """The schedule, filtered by the server. `phases` and `currentPhase` are for the whole project."""
    project = visible_project(user, project_id)
    tasks = _project_tasks(project["id"])
    filters = {"statuses": _csv(status), "owner": owner or None, "due": due or None, "delayed": delayed,
               "phases": _csv(phase)}
    shown = [t for t in tasks if matches_task_filters(t, filters, user["id"])]
    phases = ordered_phases(setup(), tasks)
    dates = [project["startDate"], project["plannedFinish"]] + [d for t in tasks for d in
                                                                (t["plannedStart"], t["plannedFinish"], t["baselineFinish"]) if d]
    return {
        "tasks": [task_view(t) for t in sorted(shown, key=lambda t: phases.index(t["phase"]))],
        "total": len(tasks),
        # Every phase the project uses, in order, with its whole-phase progress (filters don't change it).
        "phases": [{"name": p, "done": sum(1 for t in tasks if t["phase"] == p and t["status"] == "done"),
                    "total": sum(1 for t in tasks if t["phase"] == p)} for p in phases],
        "phaseChoices": _phase_choices(tasks),
        "currentPhase": current_phase(setup(), tasks),
        # The date span the timeline bars are drawn against.
        "window": {"from": min(dates), "to": max(dates)},
    }


def _phase_choices(tasks: list[dict]) -> list[str]:
    """Phases a new task can go in: the project's own, then the rest of the company's."""
    return list(dict.fromkeys([*ordered_phases(setup(), tasks), *setup()["phases"]]))


@router.get("/projects/{project_id}/task-defaults")
async def new_task_defaults(project_id: str, phase: str = Query(""), user: dict = Depends(current_user)):
    """What a new task form starts with: a phase (the current one unless given) and dates."""
    project = visible_project(user, project_id)
    tasks = _project_tasks(project["id"])
    chosen = phase or current_phase(setup(), tasks) or ""
    return {**task_defaults(tasks, chosen), "phaseChoices": _phase_choices(tasks)}


@router.get("/tasks")
async def tasks_by_ids(ids: str = Query(""), user: dict = Depends(current_user)):
    s = S()
    wanted = [i for i in ids.split(",") if i]
    found = [s.tasks[i] for i in wanted if i in s.tasks and not s.tasks[i]["deletedAt"]
             and can_see_project(user, s.tasks[i]["projectId"])]
    return {"tasks": [task_view(t) for t in found]}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user: dict = Depends(current_user)):
    t = visible_task(user, task_id)
    history = sorted((h for h in S().task_history if h["taskId"] == t["id"]),
                     key=lambda h: (h["createdAt"], h["id"]), reverse=True)
    return {"task": task_view(t), "history": history}


@router.get("/me/tasks")
async def my_tasks(user: dict = Depends(current_user)):
    """Someone's own task home, grouped by the server: on now, this week, recently done."""
    s = S()
    today = today_iso()
    week_end, recent = add_days(today, 7), add_days(today, -14)
    mine = sorted((t for t in s.tasks.values() if t["ownerId"] == user["id"] and not t["deletedAt"]
                   and can_see_project(user, t["projectId"])), key=lambda t: t["plannedFinish"])
    open_ = [t for t in mine if not is_done(t["status"])]
    done = [t for t in mine if is_done(t["status"]) and (t["actualFinish"] or t["plannedFinish"]) >= recent]
    return {
        "today": [task_view(t) for t in open_ if t["plannedStart"] <= today],
        "week": [task_view(t) for t in open_ if today < t["plannedStart"] <= week_end],
        "done": [task_view(t) for t in reversed(done)],
    }


@router.post("/projects/{project_id}/tasks")
async def create_task(project_id: str, body: TaskCreate, user: dict = Depends(current_user)):
    s = S()
    project = visible_project(user, project_id)
    assert_project_active(project["id"])
    if not can(user, "task.create", project_role(user["id"], project["id"])):
        raise forbidden()
    if existing := s.tasks.get(body.id):
        if existing["projectId"] == project["id"]:
            return task_view(existing)  # a retry
        raise ApiError("VALIDATION_FAILED", "Some fields need attention.", {"fields": {"id": "Already used"}})
    if body.ownerId and not any(m["projectId"] == project["id"] and m["userId"] == body.ownerId for m in s.project_members):
        raise invalid({"ownerId": "Pick someone on this project"})
    ts = now_iso()
    work_channel = project_channel(project["id"], setup()["workChannel"])
    dates = ({"plannedStart": body.plannedStart, "plannedFinish": body.plannedFinish} if body.plannedStart
             else task_defaults(_project_tasks(project["id"]), body.phase))
    task = {
        "id": body.id, "projectId": project["id"], "phase": body.phase, "name": body.name,
        "description": body.description, "ownerId": body.ownerId,
        "plannedStart": dates["plannedStart"], "plannedFinish": dates["plannedFinish"],
        # Added after the baseline is locked = new scope: no baseline of its own.
        "baselineStart": None, "baselineFinish": None, "actualStart": None, "actualFinish": None,
        "status": "not_started", "percent": 0,
        "channelId": body.channelId or (work_channel["id"] if work_channel else None),
        "updatedAt": ts, "deletedAt": None,
    }
    s.tasks[task["id"]] = task
    history = {"id": uuid7(), "taskId": task["id"], "userId": user["id"], "field": "created", "from": None,
               "to": task["name"], "via": "app", "createdAt": ts}
    s.task_history.append(history)
    publish({"type": "task.created", "task": task_view(task), "history": [history]}, project_audience(project["id"]))
    if task["ownerId"]:
        add_activity(userId=task["ownerId"], kind="task_assigned", actorId=user["id"], projectId=project["id"],
                     channelId=task["channelId"], messageId=None, taskIds=[task["id"]],
                     text=f"{first_name(user['id'])} assigned you {task['name']}", lines=[])
    recompute_project(project["id"])
    return task_view(task)


@router.patch("/tasks/{task_id}")
async def patch_task(task_id: str, body: TaskPatch, user: dict = Depends(current_user)):
    task = visible_task(user, task_id)
    changes = body.model_dump(exclude_unset=True)
    assert_project_active(task["projectId"])
    role = project_role(user["id"], task["projectId"])
    is_manager = can(user, "task.edit_any", role)
    if not is_manager:
        if not set(changes) <= MEMBER_EDITABLE:
            raise forbidden("Only managers can change dates and details.")
        if task["ownerId"] != user["id"] or not can(user, "task.update_own", role):
            raise forbidden("You can only update your own tasks.")
    if changes.get("ownerId") and changes["ownerId"] not in project_member_ids(task["projectId"]):
        raise invalid({"ownerId": "Pick someone on this project"})
    return task_view(apply_task_changes(user["id"], task, changes, "app", is_manager))


@router.post("/tasks/{task_id}/shift")
async def shift_task(task_id: str, days: int = Query(..., ge=-60, le=60), user: dict = Depends(current_user)):
    """Moves a task's start and finish together by `days` (managers only)."""
    task = visible_task(user, task_id)
    assert_project_active(task["projectId"])
    if not can(user, "task.edit_any", project_role(user["id"], task["projectId"])):
        raise forbidden("Only managers can change dates.")
    changes = {"plannedStart": add_days(task["plannedStart"], days), "plannedFinish": add_days(task["plannedFinish"], days)}
    return task_view(apply_task_changes(user["id"], task, changes, "app", True))


@router.post("/tasks/{task_id}/confirm")
async def confirm_task(task_id: str, user: dict = Depends(current_user)):
    task = visible_task(user, task_id)
    if not can(user, "task.confirm", project_role(user["id"], task["projectId"])):
        raise forbidden("Only managers can confirm a task.")
    if task["status"] == "done":
        return task_view(task)
    return task_view(apply_task_changes(user["id"], task, {"status": "done"}, "app", True))


@router.post("/projects/{project_id}/baseline/lock")
async def lock_baseline(project_id: str, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_baseline(user, project)
    if project["baselineLocked"]:
        raise ApiError("TASK_BASELINE_LOCKED", "The baseline is already locked. Re-baseline with a reason.")
    set_baseline(project)
    if general := project_channel(project["id"], "general"):
        post_message(general, S().bot_id, type="system", body=f"{first_name(user['id'])} locked the baseline")
    return project_view(project, user)


@router.post("/projects/{project_id}/baseline/rebaseline")
async def rebaseline(project_id: str, body: Rebaseline, user: dict = Depends(current_user)):
    project = visible_project(user, project_id)
    _require_baseline(user, project)
    set_baseline(project)
    if general := project_channel(project["id"], "general"):
        post_message(general, S().bot_id, type="system",
                     body=f"{first_name(user['id'])} re-baselined the schedule · Reason: {body.reason}")
    return project_view(project, user)
