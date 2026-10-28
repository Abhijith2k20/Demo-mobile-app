"""Request bodies. Validation errors become 422 VALIDATION_FAILED with `details.fields`."""
from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Id = str
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CHANNEL_NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

MessageType = Literal["text", "image", "voice", "file", "task_card", "checkin", "issue_card", "daily_report", "status_card", "system"]
TaskStatus = Literal["not_started", "in_progress", "blocked", "done", "done_pending_confirmation"]
# Stages and job titles are the company's own (see the setup); routes check them against it.
Stage = str
JobTitle = str
ProjectRole = Literal["manager", "member"]


class Body(BaseModel):
    model_config = ConfigDict(extra="ignore")


def _id(v: str) -> str:
    if not isinstance(v, str) or len(v) < 8:
        raise ValueError("Invalid id")
    return v


def _date(v: str) -> str:
    if not ISO_DATE.match(v or ""):
        raise ValueError("Pick a date")
    return v


def _email(v: str) -> str:
    v = (v or "").strip().lower()
    if not EMAIL.match(v):
        raise ValueError("Enter a valid work email")
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

class OtpRequest(Body):
    email: str
    v_e = field_validator("email")(_email)


class OtpVerify(Body):
    email: str
    code: str = Field(min_length=6, max_length=6)
    v_e = field_validator("email")(_email)


class Refresh(Body):
    refreshToken: str = ""


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


# ---- Tasks ----

class TaskCreate(Body):
    id: Id
    name: str
    phase: str = Field(min_length=1)
    ownerId: Optional[Id] = None
    # Left out: the server picks them (after the phase's last task, three days long).
    plannedStart: Optional[str] = None
    plannedFinish: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    channelId: Optional[Id] = None
    v_n = field_validator("name")(_name(1, 120, "Give the task a name"))
    v_d = field_validator("plannedStart", "plannedFinish")(_date)

    @model_validator(mode="after")
    def finish_after_start(self):
        if (self.plannedStart is None) != (self.plannedFinish is None):
            raise ValueError("plannedFinish|Give both dates or neither")
        if self.plannedStart and self.plannedFinish < self.plannedStart:
            raise ValueError("plannedFinish|Finish must be on or after start")
        return self


class TaskPatch(Body):
    name: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    phase: Optional[str] = Field(default=None, min_length=1)
    ownerId: Optional[Id] = None
    plannedStart: Optional[str] = None
    plannedFinish: Optional[str] = None
    status: Optional[TaskStatus] = None
    percent: Optional[int] = Field(default=None, ge=0, le=100)

    @field_validator("name")
    @classmethod
    def name_ok(cls, v):
        return None if v is None else _name(1, 120, "Give the task a name")(v)

    @field_validator("plannedStart", "plannedFinish")
    @classmethod
    def dates_ok(cls, v):
        return None if v is None else _date(v)


class CheckinAnswer(Body):
    kind: Literal["started", "progress", "problem", "done", "not_started"]
    percent: Optional[int] = Field(default=None, ge=0, le=100)
    reason: Optional[str] = Field(default=None, max_length=200)
    note: Optional[str] = Field(default=None, max_length=500)
    voiceSec: Optional[int] = Field(default=None, ge=1, le=600)
    hasPhoto: Optional[bool] = None


class Rebaseline(Body):
    reason: str
    v_r = field_validator("reason")(_name(3, 300, "Give a short reason"))


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
    stage: Optional[Stage] = None
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

class UserInvite(Body):
    id: Id
    name: str
    email: str
    companyRole: Literal["member", "admin"]
    v_n = field_validator("name")(_name(2, 60, "Enter their name"))
    v_e = field_validator("email")(_email)


# ---- Demo panel ----

class NetworkConfig(Body):
    mode: Optional[Literal["online", "slow", "flaky"]] = None
    inject: Optional[Literal["500", "403", "422", "timeout_after_save", "none"]] = None


class ActorsConfig(Body):
    paused: bool


class AsUser(Body):
    userId: Id
