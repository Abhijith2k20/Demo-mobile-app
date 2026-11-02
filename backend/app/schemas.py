"""Request bodies. Validation errors become 422 VALIDATION_FAILED with `details.fields`."""
from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Id = str
CHANNEL_NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

MessageType = Literal["text", "image", "voice", "file", "checkin", "issue_card", "daily_report", "status_card", "system"]
# Job titles are the company's own (see the setup); routes check them against it.
JobTitle = str
ProjectRole = Literal["manager", "member"]


class Body(BaseModel):
    model_config = ConfigDict(extra="ignore")


def _id(v: str) -> str:
    if not isinstance(v, str) or len(v) < 8:
        raise ValueError("Invalid id")
    return v


def _name(min_len: int, max_len: int, message: str):
    def check(v: str) -> str:
        v = (v or "").strip()
        if len(v) < min_len:
            raise ValueError(message)
        if len(v) > max_len:
            raise ValueError(f"Keep it under {max_len} characters")
        return v

    return check


def normalize_channel_name(value: str) -> str:
    v = value.strip().lower().lstrip("#")
    v = re.sub(r"[\s_]+", "-", v)
    v = re.sub(r"[^a-z0-9-]", "", v)
    v = re.sub(r"-+", "-", v).strip("-")
    return v


def _channel_name(v: str) -> str:
    if len(v) < 2:
        raise ValueError("Use at least 2 letters")
    if len(v) > 30:
        raise ValueError("Keep it under 30 characters")
    if not CHANNEL_NAME.match(v):
        raise ValueError("Use lowercase letters, numbers and hyphens")
    return v


# ---- Auth ----

class CodeRequest(Body):
    identifier: str = Field(min_length=3, max_length=120)  # work email or phone; normalised by services/accounts


class CodeVerify(Body):
    identifier: str = Field(min_length=3, max_length=120)
    code: str = Field(min_length=6, max_length=6)


class PickCompany(Body):
    companyId: Id


class Refresh(Body):
    refreshToken: str = ""


class MePatch(Body):
    name: Optional[str] = None
    notify: Optional[dict[str, Any]] = None
    v_n = field_validator("name")(lambda v: None if v is None else _name(2, 60, "Enter your name")(v))

    @field_validator("notify")
    @classmethod
    def notify_ok(cls, v):
        if v is None:
            return v
        if v.get("level") not in ("all", "important", "off"):
            raise ValueError("Pick a notification level")
        for k in ("quietFrom", "quietTo"):
            if v.get(k) is not None and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(v[k])):
                raise ValueError("Use a time like 21:00")
        return {k: v.get(k) for k in ("level", "quietFrom", "quietTo")}


class PushToken(Body):
    token: str = Field(min_length=10, max_length=300)
    platform: Literal["ios", "android"]


# ---- Messages ----

class MessageCreate(Body):
    id: Id
    type: MessageType
    body: Optional[str] = Field(default=None, max_length=4000)
    data: Optional[dict[str, Any]] = None
    threadParentId: Optional[Id] = None
    v_i = field_validator("id")(_id)


class MessagePatch(Body):
    body: Optional[str] = Field(default=None, min_length=1, max_length=4000)
    pinned: Optional[bool] = None


class Reaction(Body):
    on: bool


class ReadMarker(Body):
    upToMessageId: Id


class DmOpen(Body):
    userId: Id


# ---- Check-ins ----

class CheckinAnswer(Body):
    kind: Literal["started", "progress", "problem", "done", "not_started"]
    percent: Optional[int] = Field(default=None, ge=0, le=100)
    reason: Optional[str] = Field(default=None, max_length=200)
    note: Optional[str] = Field(default=None, max_length=500)
    voiceSec: Optional[int] = Field(default=None, ge=1, le=600)
    hasPhoto: Optional[bool] = None


# ---- Projects, members, channels ----

class ProjectCreate(Body):
    id: Id
    name: str
    client: str
    address: str = ""
    v_n = field_validator("name")(_name(2, 80, "Give the project a name"))
    v_c = field_validator("client")(_name(1, 80, "Who is the client?"))
    v_a = field_validator("address")(_name(0, 160, ""))


class ProjectPatch(Body):
    name: Optional[str] = None
    client: Optional[str] = None
    address: Optional[str] = None
    archived: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def n(cls, v):
        return None if v is None else _name(2, 80, "Give the project a name")(v)

    @field_validator("client")
    @classmethod
    def c(cls, v):
        return None if v is None else _name(1, 80, "Who is the client?")(v)

    @field_validator("address")
    @classmethod
    def a(cls, v):
        return None if v is None else _name(0, 160, "")(v)


class MemberAdd(Body):
    userId: Id
    role: ProjectRole
    jobTitle: JobTitle
    channelIds: list[Id] = []


class MemberPatch(Body):
    role: Optional[ProjectRole] = None
    jobTitle: Optional[JobTitle] = None
    channelIds: Optional[list[Id]] = None


class ChannelCreate(Body):
    id: Id
    name: str
    isPrivate: bool = False
    memberIds: list[Id] = []

    @field_validator("name", mode="before")
    @classmethod
    def n(cls, v):
        return _channel_name(normalize_channel_name(str(v or "")))


class ChannelPatch(Body):
    name: Optional[str] = None
    isPrivate: Optional[bool] = None
    memberIds: Optional[list[Id]] = None

    @field_validator("name", mode="before")
    @classmethod
    def n(cls, v):
        return None if v is None else _channel_name(normalize_channel_name(str(v)))


# ---- People ----

class InviteCreate(Body):
    id: Id
    identifier: str = Field(min_length=3, max_length=120)
    name: str
    role: Literal["admin", "member", "guest"]
    channelIds: list[Id] = []
    v_n = field_validator("name")(_name(2, 60, "Enter their name"))


class RoleChange(Body):
    role: Literal["admin", "member", "guest"]


# ---- Platform (the Siteline team) ----

class CompanyCreate(Body):
    name: str
    timeZone: str = "Asia/Kolkata"
    template: Literal["interiors", "events", "general"] = "general"
    ownerName: str
    ownerIdentifier: str = Field(min_length=3, max_length=120)
    pmCompanyId: Optional[str] = None
    pmKind: Literal["none", "mock", "http"] = "mock"
    pmBaseUrl: Optional[str] = None
    pmApiKey: Optional[str] = None
    pmWebhookSecret: Optional[str] = None
    v_n = field_validator("name")(_name(2, 80, "Give the company a name"))
    v_o = field_validator("ownerName")(_name(2, 60, "Enter the owner's name"))

    @field_validator("timeZone")
    @classmethod
    def tz_ok(cls, v):
        from zoneinfo import ZoneInfo

        try:
            ZoneInfo(v)
        except Exception:
            raise ValueError("Pick a time zone like Asia/Kolkata")
        return v


# ---- Demo panel ----

class NetworkConfig(Body):
    mode: Optional[Literal["online", "slow", "flaky"]] = None
    inject: Optional[Literal["500", "403", "422", "timeout_after_save", "none"]] = None


class ActorsConfig(Body):
    paused: bool


class AsUser(Body):
    userId: Id
