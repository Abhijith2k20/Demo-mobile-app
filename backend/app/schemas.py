"""Request bodies. Validation errors become 422 VALIDATION_FAILED with `details.fields`."""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Id = str
CHANNEL_NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

MessageType = Literal["text", "image", "voice", "file", "card", "system"]


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
    identifier: str = Field(min_length=3, max_length=120)  # work email; normalised by services/accounts


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
        return {"level": v["level"]}


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


class MuteSetting(Body):
    muted: bool


class DmOpen(Body):
    userId: Id


# ---- Cards (docs/CARDS_API.md) ----

Text = Field(min_length=1, max_length=200)


class Badge(Body):
    text: str = Field(min_length=1, max_length=40)
    tone: Literal["info", "success", "warning", "danger"] = "info"


class CardField(Body):
    label: str = Field(min_length=1, max_length=40)
    value: str = Field(max_length=120)


class ScaleStop(Body):
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=20)


class Choice(Body):
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=60)
    noteRequired: bool = False


class CardButton(Body):
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=30)
    choices: list[Choice] = Field(default=[], max_length=8)
    noteRequired: bool = False


class NoteRules(Body):
    text: bool = False
    voice: bool = False
    photo: bool = False


class PushText(Body):
    title: Optional[str] = Field(default=None, max_length=60)
    body: Optional[str] = Field(default=None, max_length=180)


class CardContent(Body):
    title: str = Text
    subtitle: Optional[str] = Field(default=None, max_length=200)
    badge: Optional[Badge] = None
    fields: list[CardField] = Field(default=[], max_length=8)
    scale: list[ScaleStop] = Field(default=[], max_length=6)
    scaleReached: Optional[str] = None
    buttons: list[CardButton] = Field(default=[], max_length=3)
    note: Optional[NoteRules] = None
    push: Optional[PushText] = None

    @model_validator(mode="after")
    def ids_unique(self):
        ids = [x.id for x in self.scale] + [b.id for b in self.buttons]
        if len(ids) != len(set(ids)):
            raise ValueError("buttons|Every scale stop and button needs its own id")
        if self.scaleReached and self.scaleReached not in {x.id for x in self.scale}:
            raise ValueError("scaleReached|Not one of the scale's ids")
        return self


class CardCreate(CardContent):
    id: str = Field(min_length=1, max_length=120)
    to: str = Field(min_length=3, max_length=120)
    ref: dict[str, Any] = {}
    expiresAt: Optional[datetime] = None

    @field_validator("ref")
    @classmethod
    def ref_small(cls, v):
        if len(json.dumps(v)) > 2000:
            raise ValueError("Keep ref under 2 KB")
        return v


class CardPatch(Body):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    subtitle: Optional[str] = Field(default=None, max_length=200)
    badge: Optional[Badge] = None
    fields: Optional[list[CardField]] = Field(default=None, max_length=8)
    scale: Optional[list[ScaleStop]] = Field(default=None, max_length=6)
    scaleReached: Optional[str] = None
    buttons: Optional[list[CardButton]] = Field(default=None, max_length=3)
    note: Optional[NoteRules] = None
    expiresAt: Optional[datetime] = None
    closed: bool = False
    closedText: Optional[str] = Field(default=None, max_length=120)


class CardAnswer(Body):
    """From the app (through the send queue)."""
    scale: Optional[str] = Field(default=None, max_length=40)
    button: Optional[str] = Field(default=None, max_length=40)
    choice: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=500)
    voiceUploadId: Optional[Id] = None
    voiceSec: Optional[int] = Field(default=None, ge=1, le=120)
    photoUploadIds: list[Id] = Field(default=[], max_length=4)
    answeredAt: Optional[datetime] = None


# ---- Projects, members, channels ----

class ProjectCreate(Body):
    id: Id
    name: str
    client: str = ""
    address: str = ""
    v_n = field_validator("name")(_name(2, 80, "Give the project a name"))
    v_c = field_validator("client")(_name(0, 80, ""))
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
        return None if v is None else _name(0, 80, "")(v)  # optional, as when the project was made

    @field_validator("address")
    @classmethod
    def a(cls, v):
        return None if v is None else _name(0, 160, "")(v)


class MemberAdd(Body):
    userId: Id
    channelIds: list[Id] = []


class MemberPatch(Body):
    """The channels of this project the person is in."""
    channelIds: list[Id]


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
    ownerName: str
    ownerIdentifier: str = Field(min_length=3, max_length=120)
    pmCompanyId: Optional[str] = None
    pmKind: Literal["none", "mock", "http"] = "mock"
    pmWebhookUrl: Optional[str] = Field(default=None, max_length=500)
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


class AsUser(Body):
    userId: Id
