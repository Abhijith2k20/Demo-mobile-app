"""Small building blocks: ids, the server clock and the standard error."""
from __future__ import annotations

import os
import secrets
import time
from datetime import datetime, timezone

ERROR_STATUS = {
    "OTP_INVALID": 400,
    "OTP_EXPIRED": 400,
    "OTP_TOO_MANY_ATTEMPTS": 429,
    "AUTH_EXPIRED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "VALIDATION_FAILED": 422,
    "TASK_BASELINE_LOCKED": 409,
    "MESSAGE_EDIT_WINDOW_PASSED": 409,
    "CHANNEL_READ_ONLY": 403,
    "CHANNEL_NAME_TAKEN": 409,
    "EMAIL_TAKEN": 409,
    "CHANNEL_PRIVATE": 403,
    "PROJECT_ARCHIVED": 409,
    "RATE_LIMITED": 429,
    "INTERNAL_ERROR": 500,
    "SERVICE_UNAVAILABLE": 503,
}


class ApiError(Exception):
    """Every refusal the API gives. Rendered as {"error": {code, message, details, request_id}}."""

    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.status = ERROR_STATUS[code]
        self.message = message
        self.details = details or {}


def not_found(what: str = "Resource") -> ApiError:
    return ApiError("NOT_FOUND", f"{what} not found.")


def forbidden(message: str = "You don't have permission to do that.") -> ApiError:
    return ApiError("FORBIDDEN", message)


def invalid(fields: dict[str, str]) -> ApiError:
    return ApiError("VALIDATION_FAILED", "Some fields need attention.", {"fields": fields})


# ---- Ids ----

def uuid7() -> str:
    """UUIDv7: time-ordered, so sorting ids sorts by creation time (messages rely on this)."""
    ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ms & ((1 << 48) - 1)) << 80 | (0x7 << 76) | ((rand >> 62) & 0xFFF) << 64 | (0b10 << 62) | (rand & ((1 << 62) - 1))
    h = f"{value:032x}"
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def new_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(24)}"


# ---- Clock ----

_last_ms = 0


def now_ms() -> int:
    """Strictly increasing, so `updatedAt` comparisons are never ambiguous."""
    global _last_ms
    t = time.time_ns() // 1_000_000
    _last_ms = t if t > _last_ms else _last_ms + 1
    return _last_ms


def iso_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def now_iso() -> str:
    return iso_ms(now_ms())


def parse_iso_ms(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def avatar_tone(user_id: str) -> str:
    """Same palette and hash as the app's theme, so colours match across restarts."""
    tones = ["#B5694A", "#6F8A6B", "#5C6F80", "#B48A3C", "#7D5A78", "#3F7F80", "#A08A66", "#9C4A33"]
    h = 0
    for ch in user_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return tones[h % len(tones)]
