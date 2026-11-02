"""Who is calling. Every route except sign-in needs a valid access token for a company session; the
company comes from that session (never from the request) and is set on the transaction (spec §9.7)."""
from __future__ import annotations

from fastapi import Header

from . import db
from .core import ApiError
from .services import accounts
from .store import person


def bearer(authorization: str) -> str:
    return authorization.removeprefix("Bearer ").strip()


def session_for(token: str) -> dict:
    s = accounts.session_for_access(token)
    if not s:
        raise ApiError("AUTH_EXPIRED", "Your session has expired.")
    return s


def user_for_session(s: dict) -> dict:
    """The person inside the session's company; sets that company on the current transaction."""
    if not s["companyId"]:
        raise ApiError("NO_COMPANY", "Pick a company first.")
    m = accounts.membership(s["userId"], s["companyId"])
    if not m or m["companyStatus"] != "active":
        raise ApiError("COMPANY_SUSPENDED" if m and m["companyStatus"] == "suspended" else "NOT_A_MEMBER",
                       "This company isn't available on Siteline right now." if m else "You're not in this company.")
    db.current().set_company(s["companyId"])
    user = person(s["userId"])
    if not user or not user["isActive"]:
        raise ApiError("AUTH_EXPIRED", "Your session has expired.")
    return {**user, "sessionId": s["id"]}


def user_for_token(token: str) -> dict:
    return user_for_session(session_for(token))


def current_user(authorization: str = Header(default="")) -> dict:
    return user_for_token(bearer(authorization))


def current_account(authorization: str = Header(default="")) -> dict:
    """The signed-in person for /auth routes that work before a company is picked."""
    s = session_for(bearer(authorization))
    user = db.row("SELECT * FROM users WHERE id = %(id)s AND deleted_at IS NULL", id=s["userId"])
    if not user:
        raise ApiError("AUTH_EXPIRED", "Your session has expired.")
    return {**user, "sessionId": s["id"], "sessionCompanyId": s["companyId"]}

