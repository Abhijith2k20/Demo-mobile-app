"""In-memory data. Records are plain dicts with the same camelCase keys the API returns.
Everything resets on restart or `POST /internal/reset`; that is the "mock" part."""
from __future__ import annotations

from dataclasses import dataclass, field

from .core import now_iso
from .rules import is_company_admin


@dataclass
class Store:
    company_id: str = ""
    company: dict = field(default_factory=dict)  # id, name, setup (the company's own stages, job titles...)
    bot_id: str = ""
    users: dict[str, dict] = field(default_factory=dict)
    projects: dict[str, dict] = field(default_factory=dict)
    project_members: list[dict] = field(default_factory=list)  # + joinedAt
    channels: dict[str, dict] = field(default_factory=dict)
    channel_members: list[dict] = field(default_factory=list)  # + joinedAt
    messages: dict[str, dict] = field(default_factory=dict)
    tasks: dict[str, dict] = field(default_factory=dict)
    task_history: list[dict] = field(default_factory=list)
    checkins: dict[str, dict] = field(default_factory=dict)  # + messageId, remindedAt, escalatedAt
    activities: list[dict] = field(default_factory=list)  # + readAt (server-side read state)
    uploads: dict[str, dict] = field(default_factory=dict)  # id -> {id, userId, path, contentType}
    tokens: dict[str, dict] = field(default_factory=dict)  # token -> {userId, kind, expired}
    otp_attempts: dict[str, tuple[int, int]] = field(default_factory=dict)  # email -> (wrong codes, since ms)


_store: Store | None = None


def S() -> Store:
    global _store
    if _store is None:
        from .seed import build

        _store = build()
    return _store


def reset_store() -> Store:
    global _store
    from .seed import build

    _store = build()
    return _store


# ---- Lookups ----

def setup() -> dict:
    """The company's own words and defaults: stages, phases, job titles, standard channels."""
    return S().company["setup"]


def humans() -> list[dict]:
    s = S()
    return [u for u in s.users.values() if u["id"] != s.bot_id and u["isActive"]]


def admins() -> list[str]:
    return [u["id"] for u in humans() if is_company_admin(u)]


def project_role(user_id: str, project_id: str) -> str | None:
    for m in S().project_members:
        if m["userId"] == user_id and m["projectId"] == project_id:
            return m["role"]
    return None


def project_member(user_id: str, project_id: str) -> dict | None:
    return next((m for m in S().project_members if m["userId"] == user_id and m["projectId"] == project_id), None)


def project_member_ids(project_id: str) -> set[str]:
    return {m["userId"] for m in S().project_members if m["projectId"] == project_id}


def project_managers(project_id: str) -> list[str]:
    return [m["userId"] for m in S().project_members if m["projectId"] == project_id and m["role"] == "manager"]


def is_channel_member(user_id: str, channel_id: str) -> bool:
    return any(m["userId"] == user_id and m["channelId"] == channel_id for m in S().channel_members)


def channel_member_ids(channel_id: str) -> list[str]:
    return [m["userId"] for m in S().channel_members if m["channelId"] == channel_id]


def project_channels(project_id: str) -> list[dict]:
    return [c for c in S().channels.values() if c["projectId"] == project_id]


def project_channel(project_id: str, name: str) -> dict | None:
    return next((c for c in S().channels.values() if c["projectId"] == project_id and c["name"] == name), None)


def bot_channel_for(user_id: str) -> dict | None:
    return next((c for c in S().channels.values() if c["kind"] == "bot" and is_channel_member(user_id, c["id"])), None)


def ensure_channel_member(user_id: str, channel_id: str) -> dict:
    """Admins read every project channel without being listed; they get a row for read markers."""
    for m in S().channel_members:
        if m["userId"] == user_id and m["channelId"] == channel_id:
            return m
    row = {"channelId": channel_id, "userId": user_id, "lastReadMessageId": None, "joinedAt": now_iso()}
    S().channel_members.append(row)
    return row


def first_name(user_id: str) -> str:
    u = S().users.get(user_id)
    return u["name"].split(" ")[0] if u else "Someone"


def short_project(project_id: str | None) -> str:
    p = S().projects.get(project_id or "")
    return p["name"].split(" – ")[0] if p else "the project"
