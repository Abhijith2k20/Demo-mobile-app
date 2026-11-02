"""Lookups shared by routes, services and the bot. Everything reads the current transaction's company
(app/db.py); row-level security keeps other companies' rows out even if a query forgot to filter.

A "person" is a user as seen inside the current company: their account plus their membership
(`companyRole`, `isActive`)."""
from __future__ import annotations

from . import db
from .core import now_iso
from .rules import is_company_admin

BOT_ID = "siteline-bot"
BOT_EMAIL = "bot@siteline.app"

_PEOPLE = """
  SELECT u.id, u.name, u.email, u.phone, u.avatar_color, u.language, m.role AS company_role,
         (m.status = 'active' AND u.deleted_at IS NULL) AS is_active, m.updated_at
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.company_id = current_company()
"""


def _with_presence(p: dict | None) -> dict | None:
    if p is not None:
        from .events import hub

        p["online"] = hub.is_online(p["id"], db.company_id())
    return p


# ---- Company ----

def company() -> dict:
    return db.row("SELECT * FROM companies WHERE id = current_company()")


def setup() -> dict:
    """The company's own words and defaults: job titles, standard channels, problem types."""
    return company()["setup"]


# ---- People ----

def person(user_id: str | None) -> dict | None:
    if not user_id:
        return None
    if user_id == BOT_ID:
        return {"id": BOT_ID, "name": "Siteline Bot", "email": BOT_EMAIL, "phone": None, "avatarColor": "slate",
                "language": "en", "companyRole": "member", "isActive": True, "online": True}
    return _with_presence(db.row(_PEOPLE + " AND u.id = %(id)s", id=user_id))


def people() -> list[dict]:
    """Everyone in the company, deactivated people included, by name."""
    return [_with_presence(p) for p in db.rows(_PEOPLE + " ORDER BY u.name")]


def humans() -> list[dict]:
    return [p for p in people() if p["isActive"]]


def human_ids() -> list[str]:
    return [p["id"] for p in humans()]


def admins() -> list[str]:
    return [p["id"] for p in humans() if is_company_admin(p)]


def first_name(user_id: str | None) -> str:
    u = person(user_id)
    return u["name"].split(" ")[0] if u else "Someone"


# ---- Projects ----

def project(project_id: str | None) -> dict | None:
    return db.row("SELECT * FROM projects WHERE id = %(id)s", id=project_id) if project_id else None


def project_member(user_id: str, project_id: str) -> dict | None:
    return db.row("SELECT * FROM project_members WHERE user_id = %(u)s AND project_id = %(p)s", u=user_id, p=project_id)


def project_role(user_id: str, project_id: str | None) -> str | None:
    m = project_member(user_id, project_id) if project_id else None
    return m["role"] if m else None


def project_members(project_id: str) -> list[dict]:
    return db.rows("SELECT * FROM project_members WHERE project_id = %(p)s ORDER BY joined_at, user_id", p=project_id)


def project_member_ids(project_id: str) -> set[str]:
    return {m["userId"] for m in project_members(project_id)}


def project_managers(project_id: str) -> list[str]:
    return [m["userId"] for m in project_members(project_id) if m["role"] == "manager"]


def short_project(project_id: str | None) -> str:
    p = project(project_id)
    return p["name"].split(" – ")[0] if p else "the project"


# ---- Channels ----

def channel(channel_id: str | None) -> dict | None:
    return db.row("SELECT * FROM channels WHERE id = %(id)s", id=channel_id) if channel_id else None


def is_channel_member(user_id: str, channel_id: str) -> bool:
    return bool(db.value("SELECT 1 FROM channel_members WHERE user_id = %(u)s AND channel_id = %(c)s", u=user_id, c=channel_id))


def channel_member_ids(channel_id: str) -> list[str]:
    return [r["userId"] for r in db.rows("SELECT user_id FROM channel_members WHERE channel_id = %(c)s", c=channel_id)]


def project_channels(project_id: str) -> list[dict]:
    return db.rows("SELECT * FROM channels WHERE project_id = %(p)s", p=project_id)


def project_channel(project_id: str | None, name: str) -> dict | None:
    if not project_id:
        return None
    return db.row("SELECT * FROM channels WHERE project_id = %(p)s AND name = %(n)s", p=project_id, n=name)


def bot_channel_for(user_id: str) -> dict | None:
    return db.row("""SELECT c.* FROM channels c JOIN channel_members m ON m.channel_id = c.id
                     WHERE c.kind = 'bot' AND m.user_id = %(u)s LIMIT 1""", u=user_id)


def add_channel_member(channel_id: str, user_id: str) -> bool:
    """Adds the person; False if they were already in it."""
    return db.insert("channel_members", {"companyId": db.company_id(), "channelId": channel_id, "userId": user_id,
                                         "lastReadMessageId": None, "joinedAt": now_iso()},
                     on_conflict_nothing=True) is not None


def ensure_channel_member(user_id: str, channel_id: str) -> dict:
    """Admins read every project channel without being listed; they get a row for read markers."""
    add_channel_member(channel_id, user_id)
    return db.row("SELECT * FROM channel_members WHERE user_id = %(u)s AND channel_id = %(c)s", u=user_id, c=channel_id)


# ---- Messages ----

MESSAGE_COLUMNS = "m.*, 'sent' AS status"


def message(message_id: str | None) -> dict | None:
    if not message_id:
        return None
    return db.row(f"SELECT {MESSAGE_COLUMNS} FROM messages m WHERE id = %(id)s", id=message_id)
