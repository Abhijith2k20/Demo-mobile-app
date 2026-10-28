"""Changing tasks: the consequences of a change (via rules.normalize_task_change), history,
live events, batched notifications, the project's planned finish, and baselines.
Used by the task routes, check-in answers and the scripted teammates."""
from __future__ import annotations

from ..core import invalid, now_iso, uuid7
from ..events import publish
from ..notify import add_activity, queue_task_change
from ..rules import normalize_task_change, short_date
from ..access import project_audience
from ..store import S, first_name
from ..views import task_view


def recompute_project(project_id: str) -> None:
    """The project's planned finish is its latest task finish."""
    s = S()
    p = s.projects.get(project_id)
    if not p:
        return
    finishes = [t["plannedFinish"] for t in s.tasks.values() if t["projectId"] == project_id and not t["deletedAt"]]
    latest = max(finishes, default="")
    if latest and latest != p["plannedFinish"]:
        p["plannedFinish"] = latest
        p["updatedAt"] = now_iso()
        publish({"type": "project.updated", "project": p}, project_audience(project_id))


def describe_change(field: str, old: str | None, new: str | None) -> tuple[str, str]:
    if field == "plannedStart":
        return "dates", f"start {short_date(old) if old else '—'} → {short_date(new) if new else '—'}"
    if field == "plannedFinish":
        return "dates", f"finish {short_date(old) if old else '—'} → {short_date(new) if new else '—'}"
    if field == "percent":
        return "progress", f"progress {old}% → {new}%"
    if field == "status":
        return "status", f"status → {(new or '').replace('_', ' ')}"
    return "details", f"{field} changed"


def apply_task_changes(actor_id: str, task: dict, changes: dict, via: str, is_manager: bool) -> dict:
    """Applies already-authorised changes: consequences, history per field, event, notifications."""
    s = S()
    changes = normalize_task_change(task, changes, is_manager)
    start = changes.get("plannedStart", task["plannedStart"])
    finish = changes.get("plannedFinish", task["plannedFinish"])
    if finish < start:
        raise invalid({"plannedFinish": "Finish must be on or after start"})
    if not changes:
        return task
    ts = now_iso()
    history = []
    previous_owner = task["ownerId"]
    for key, new in changes.items():
        if key in ("actualStart", "actualFinish"):
            continue
        old = task.get(key)
        entry = {
            "id": uuid7(), "taskId": task["id"], "userId": actor_id, "field": key,
            "from": None if old is None else str(old), "to": None if new is None else str(new),
            "via": via, "createdAt": ts,
        }
        history.append(entry)
        s.task_history.append(entry)
        if key != "ownerId":
            kind, line = describe_change(key, entry["from"], entry["to"])
            queue_task_change(actor_id, {**task, **changes}, kind, line)
    task.update(changes)
    task["updatedAt"] = ts
    publish({"type": "task.updated", "task": task_view(task), "history": history}, project_audience(task["projectId"]))
    if changes.get("ownerId") and changes["ownerId"] != previous_owner:
        add_activity(userId=changes["ownerId"], kind="task_assigned", actorId=actor_id, projectId=task["projectId"],
                     channelId=task["channelId"], messageId=None, taskIds=[task["id"]],
                     text=f"{first_name(actor_id)} assigned you {task['name']}", lines=[])
    if "plannedFinish" in changes:
        recompute_project(task["projectId"])
    return task


def set_baseline(project: dict) -> None:
    s = S()
    ts = now_iso()
    latest = ""
    for t in s.tasks.values():
        if t["projectId"] != project["id"] or t["deletedAt"]:
            continue
        t.update(baselineStart=t["plannedStart"], baselineFinish=t["plannedFinish"], updatedAt=ts)
        latest = max(latest, t["plannedFinish"])
        publish({"type": "task.updated", "task": task_view(t), "history": []}, project_audience(project["id"]))
    project.update(baselineLocked=True, baselineFinish=latest or project["plannedFinish"], updatedAt=now_iso())
    publish({"type": "project.updated", "project": project}, project_audience(project["id"]))
