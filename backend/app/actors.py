"""Scripted teammates (§10.6): every 20–40 s one of them posts or edits, so the demo feels alive.
They act through the same write paths as real users, so everyone gets the same events."""
from __future__ import annotations

import random

from .core import uuid7
from .events import cancel, later
from .store import S, project_channel
from .services.messaging import post_message

_state = {"paused": False, "step": 0, "timer": None}


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


def rohan_posts_qs(n: int) -> None:
    _post("Rohan", "Villa 99", "qs", _pick([
        "Laminate quote received: ₹1,450/sheet, within budget.",
        "Paint estimate revised to ₹86,000 after shade change.",
        "Vendor agreed to the 2% credit on gypsum boards.",
    ], n))


def owner_announces(n: int) -> None:
    _post("Arjun", None, "announcements", _pick([
        "Monthly review is on the 15th. PMs, please bring your site photos.",
        "Safety reminder: helmets on at all sites.",
    ], n))


SCRIPT = [kavya_posts_design, suresh_posts_site, rohan_posts_qs, suresh_posts_site, kavya_posts_design, owner_announces]


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
    _state.update(paused=False, step=0, timer=None)
