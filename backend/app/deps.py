"""Who is calling. Every route except sign-in and the Demo panel needs a valid access token."""
from __future__ import annotations

from fastapi import Header

from .core import ApiError
from .rules import LANGUAGES
from .store import S


def user_for_token(token: str, kind: str = "access") -> dict:
    s = S()
    entry = s.tokens.get(token)
    user = s.users.get(entry["userId"]) if entry else None
    if not entry or entry["kind"] != kind or entry["expired"] or not user or not user["isActive"]:
        raise ApiError("AUTH_EXPIRED", "Your session has expired.")
    return user


async def current_user(authorization: str = Header(default="")) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    return user_for_token(token)


async def language(accept_language: str = Header(default="en")) -> str:
    """The reader's language for the company's own labels (stages, job titles)."""
    code = accept_language.split(",")[0].split("-")[0].strip().lower()
    return code if code in LANGUAGES else "en"
