"""Scripted teammates (§10.6): every 20–40 s one of them posts or edits, so the demo feels alive.
They act through the same write paths as real users, so everyone gets the same events."""
from __future__ import annotations

import random

from .core import uuid7
from .events import cancel, later
from .rules import add_days
from .store import S, project_channel, project_managers
from .services.messaging import post_message
from .services.tasks import apply_task_changes

_state = {"paused": False, "step": 0, "forward": False, "timer": None}


def paused() -> bool:
    return _state["paused"]


def set_paused(value: bool) -> None:
    _state["paused"] = value


def _user(prefix: str) -> str | None:
    return next((u["id"] for u in S().users.values() if u["name"].startswith(prefix)), None)


def _project(prefix: str) -> str | None:
    return next((p["id"] for p in S().projects.values() if p["name"].startswith(prefix)), None)


def _img(tone: str, caption: str) -> dict:
    return {"id": uuid7(), "kind": "image", "uri": None, "uploadId": None, "caption": caption, "tone": tone}


def _pick(options: list, n: int):
    return options[n % len(options)]


def _post(user: str, project: str | None, channel: str, body: str | None, photos: list[dict] | None = None) -> None:
    uid = _user(user)
    if not uid:
        return
    s = S()
    if project:
        ch = project_channel(_project(project) or "", channel)
    else:
        ch = next((c for c in s.channels.values() if c["kind"] == "company" and c["name"] == channel), None)
    if not ch or (ch["projectId"] and s.projects.get(ch["projectId"], {}).get("archivedAt")):
        return
    post_message(ch, uid, type="image" if photos else "text", body=body, data={"attachments": photos} if photos else None)


def _patch(user: str, task: dict, changes: dict) -> None:
    uid = _user(user)
    if uid and not S().projects.get(task["projectId"], {}).get("archivedAt"):
        apply_task_changes(uid, task, changes, "app", uid in project_managers(task["projectId"]))


def kavya_posts_design(n: int) -> None:
    _post("Kavya", "Villa 99", "design",
          _pick(["Updated wardrobe shutter detail.", "Revised the foyer panel joinery.", "Kitchen upper unit heights adjusted."], n),
          [_img("sand", _pick(["Shutter detail", "Foyer joinery", "Upper unit section"], n)),
           _img("linen", _pick(["Elevation", "Plan view", "Side elevation"], n))])


def suresh_posts_site(n: int) -> None:
    _post("Suresh", "Villa 99", "site-work",
          _pick(["Site photos from this hour.", "Progress update from site.", "Carpentry moving well today."], n),
          [_img("stone", _pick(["Master bedroom ceiling", "Living room cove", "Kids bedroom grid"], n)),
           _img("sand", _pick(["Kitchen uppers", "Wardrobe carcass", "TV unit base"], n))])
    task = next((t for t in S().tasks.values() if t["name"] == "Kitchen carcass"), None)
    if task and task["percent"] < 90:
        _patch("Suresh", task, {"percent": min(90, task["percent"] + 5)})


def rohan_posts_qs(n: int) -> None:
    _post("Rohan", "Villa 99", "qs", _pick([
        "Laminate quote received: ₹1,450/sheet, within budget.",
        "Paint estimate revised to ₹86,000 after shade change.",
        "Vendor agreed to the 2% credit on gypsum boards.",
    ], n))


def amit_shifts_tasks(n: int) -> None:
    pid = _project("Villa 99")
    if not pid:
        return
    candidates = sorted((t for t in S().tasks.values() if t["projectId"] == pid and t["status"] == "not_started" and not t["deletedAt"]),
                        key=lambda t: t["plannedStart"])[:5]
    # Alternate a day later / earlier so a long demo doesn't drift the whole schedule.
    _state["forward"] = not _state["forward"]
    by = 1 if _state["forward"] else -1
    for t in candidates:
        _patch("Amit", t, {"plannedStart": add_days(t["plannedStart"], by), "plannedFinish": add_days(t["plannedFinish"], by)})


def owner_announces(n: int) -> None:
    _post("Arjun", None, "announcements", _pick([
        "Monthly review is on the 15th. PMs, please update your schedules.",
        "Safety reminder: helmets on at all sites.",
    ], n))


SCRIPT = [kavya_posts_design, suresh_posts_site, rohan_posts_qs, amit_shifts_tasks, suresh_posts_site, kavya_posts_design, owner_announces]


def _someone_signed_in() -> bool:
    # Someone has the app open (tokens never expire on their own, so they can't tell).
    from .events import hub

    return any(hub.conns.values())


def _tick() -> None:
    from . import netsim

    _state["timer"] = None
    if not _state["paused"] and netsim.state()["mode"] == "online" and _someone_signed_in():
        SCRIPT[_state["step"] % len(SCRIPT)](_state["step"])
        _state["step"] += 1
    _plan()


def _plan() -> None:
    cancel(_state["timer"])
    _state["timer"] = later(20 + random.random() * 20, _tick)


def start() -> None:
    if not _state["timer"]:
        _plan()


def reset() -> None:
    cancel(_state["timer"])
    _state.update(paused=False, step=0, forward=False, timer=None)
