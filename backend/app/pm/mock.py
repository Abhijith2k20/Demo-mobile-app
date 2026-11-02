"""A stand-in for the company's PM app (spec §9.3) until its API exists. It holds projects and tasks the
way the real one will answer them; Siteline reaches it only through `connector.py`.

shortcut: the data sits in the in-memory store (`S().pm`); it moves to its own Postgres schema with the
database (build step 3)."""
from __future__ import annotations

from ..core import now_iso
from ..store import S

OPEN = ("not_started", "in_progress", "blocked")


class Refused(Exception):
    """The PM app said no (the reason is shown to the person)."""


def _data() -> dict:
    return S().pm


def list_projects() -> list[dict]:
    return list(_data()["projects"].values())


def list_tasks(project_id: str | None = None, owner_ref: str | None = None) -> list[dict]:
    return [dict(t) for t in _data()["tasks"].values()
            if (project_id is None or t["projectId"] == project_id) and (owner_ref is None or t["ownerRef"] == owner_ref)]


def get_task(task_id: str) -> dict | None:
    t = _data()["tasks"].get(task_id)
    return dict(t) if t else None


def write_status(task_id: str, change: dict, key: str) -> dict:
    """`change` is {status, percent?, note?, problem?}. The same `key` twice writes once."""
    pm = _data()
    if key in pm["writes"]:
        return dict(pm["writes"][key])
    t = pm["tasks"].get(task_id)
    if not t:
        raise Refused("This task was removed")
    if t["status"] not in OPEN:
        raise Refused("This task is already closed")
    t["status"] = change["status"]
    if change["status"] == "done":
        t["percent"] = 100
    elif change.get("percent") is not None:
        t["percent"] = change["percent"]
    t["updatedAt"] = now_iso()
    pm["writes"][key] = dict(t)
    return dict(t)
