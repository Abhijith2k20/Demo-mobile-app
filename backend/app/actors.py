"""Scripted teammates (development and staging only, spec §11): every 20–40 s one of them posts in the seeded
Paliath company, so the app feels alive. They act through the same write paths as real users."""
from __future__ import annotations

import random

from . import db
from .core import uuid7
from .events import cancel, hub, later
from .services.messaging import post_message
from .store import project_channel

_state: dict = {"paused": False, "step": 0, "timer": None, "loop": None}
COMPANY_SLUG = "paliath-interiors"


def paused() -> bool:
    return _state["paused"]


def set_paused(value: bool) -> None:
    _state["paused"] = value


def _user(prefix: str) -> str | None:
    return db.value("""SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id AND m.company_id = current_company()
                       WHERE u.name LIKE %(p)s AND m.status = 'active' LIMIT 1""", p=prefix + "%")


def _project(prefix: str) -> str | None:
    return db.value("SELECT id FROM projects WHERE name LIKE %(p)s AND archived_at IS NULL", p=prefix + "%")


def _img(tone: str, caption: str) -> dict:
    return {"id": uuid7(), "kind": "image", "uri": None, "uploadId": None, "caption": caption, "tone": tone}


def _pick(options: list, n: int):
    return options[n % len(options)]


def _post(user: str, project: str | None, channel: str, body: str | None, photos: list[dict] | None = None) -> None:
    uid = _user(user)
    if not uid:
        return
    if project:
        ch = project_channel(_project(project), channel)
    else:
        ch = db.row("SELECT * FROM channels WHERE kind = 'company' AND name = %(n)s", n=channel)
    if ch:
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


def _tick() -> None:
    from . import netsim

    _state["timer"] = None
    try:
        if not _state["paused"] and netsim.state()["mode"] == "online" and any(hub.conns.values()):
            with db.transaction():
                cid = db.value("SELECT id FROM companies WHERE slug = %(s)s AND status = 'active'", s=COMPANY_SLUG)
            if cid:
                with db.transaction(cid):
                    SCRIPT[_state["step"] % len(SCRIPT)](_state["step"])
            _state["step"] += 1
    finally:
        _plan()


def _plan() -> None:
    """Schedules the next tick on the server's event loop (ticks themselves run in a thread)."""
    loop = _state.get("loop")
    if loop is None:
        return

    def schedule() -> None:
        cancel(_state["timer"])
        _state["timer"] = later(20 + random.random() * 20, _tick)

    loop.call_soon_threadsafe(schedule)


def start() -> None:
    import asyncio

    _state["loop"] = asyncio.get_running_loop()
    if not _state["timer"]:
        _plan()


def reset() -> None:
    cancel(_state["timer"])
    _state.update(paused=False, step=0, timer=None)
