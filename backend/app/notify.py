"""Activity items. Messages notify at once; task changes are batched per recipient (§10.3)."""
from __future__ import annotations

from .core import now_iso, uuid7
from .events import cancel, later, publish
from .store import S, first_name, project_managers, short_project

BATCH_SECONDS = 10  # demo-shortened from 2 minutes

_batches: dict[str, dict] = {}


def public_activity(a: dict) -> dict:
    return {k: v for k, v in a.items() if k != "readAt"} | {"read": a.get("readAt") is not None}


def add_activity(**a) -> None:
    s = S()
    if a["userId"] == s.bot_id or a["userId"] == a["actorId"]:
        return
    activity = {"id": uuid7(), "createdAt": now_iso(), "readAt": None, **a}
    s.activities.append(activity)
    publish({"type": "activity.new", "activity": public_activity(activity)}, [a["userId"]])


def _flush(key: str) -> None:
    b = _batches.pop(key, None)
    if not b:
        return
    tasks = {e["task"]["id"]: e["task"] for e in b["entries"]}
    kinds = {e["kind"] for e in b["entries"]}
    what = b["entries"][0]["kind"] if len(kinds) == 1 else "details"
    actor = first_name(b["actor"])
    count = len(tasks)
    if count == 1:
        text = f"{actor} changed {what} on {b['entries'][0]['task']['name']}"
    else:
        text = f"{actor} changed {what} on {count} tasks in {short_project(b['projectId'])}"
        yours = sum(1 for t in tasks.values() if t["ownerId"] == b["recipient"])
        if yours:
            text += f" · {yours} {'is' if yours == 1 else 'are'} yours"
    add_activity(
        userId=b["recipient"],
        kind="task_changes",
        actorId=b["actor"],
        projectId=b["projectId"],
        channelId=None,
        messageId=None,
        taskIds=list(tasks),
        text=text,
        lines=[f"{e['task']['name']}: {e['line']}" for e in b["entries"]],
    )


def queue_task_change(actor_id: str, task: dict, kind: str, line: str) -> None:
    """One task change, for the project's managers and the task owner, sent as a batch."""
    recipients = set(project_managers(task["projectId"]))
    if task["ownerId"]:
        recipients.add(task["ownerId"])
    recipients.discard(actor_id)
    for recipient in recipients:
        key = f"{recipient}|{actor_id}|{task['projectId']}"
        b = _batches.get(key)
        if not b:
            b = {"recipient": recipient, "actor": actor_id, "projectId": task["projectId"], "entries": []}
            b["timer"] = later(BATCH_SECONDS, lambda key=key: _flush(key))
            _batches[key] = b
        b["entries"].append({"task": dict(task), "kind": kind, "line": line})


def flush_all() -> None:
    """Tests and reset: deliver every pending batch now."""
    for key in list(_batches):
        cancel(_batches[key].get("timer"))
        _flush(key)


def reset_notify() -> None:
    for b in _batches.values():
        cancel(b.get("timer"))
    _batches.clear()
