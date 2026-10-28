"""Sign-in by work email and a 6-digit code (always 123456 in the demo)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import bot
from ..core import ApiError, new_token, now_ms
from ..deps import current_user, language, user_for_token
from ..rules import job_title_info, localized
from ..services.people import end_sessions
from ..schemas import OtpRequest, OtpVerify, Refresh
from ..store import S, humans, setup
from ..views import me_view

router = APIRouter(prefix="/auth", tags=["auth"])

DEMO_OTP = "123456"
MAX_ATTEMPTS = 5
LOCK_SECONDS = 15 * 60  # a lock (and its count) lasts this long, so the table can't only grow


@router.get("/demo-accounts")
async def demo_accounts(lang: str = Depends(language)):
    """Demo build only: one sign-in per role, so every point of view is a tap away (code 123456)."""
    s = S()
    first_title = {}
    for m in s.project_members:
        first_title.setdefault(m["userId"], m["jobTitle"])
    picked, seen = [], set()
    for u in humans():
        title = first_title.get(u["id"])
        role = u["companyRole"] if u["companyRole"] != "member" else f"member:{title}"
        if role in seen or (u["companyRole"] == "member" and not title):
            continue
        seen.add(role)
        info = job_title_info(setup(), title) if title else None
        picked.append({"email": u["email"], "name": u["name"], "companyRole": u["companyRole"],
                       "jobTitle": localized(info["label"], lang) if info else None})
    return {"accounts": picked}


def issue_tokens(user_id: str) -> dict:
    s = S()
    access, refresh = new_token("at"), new_token("rt")
    s.tokens[access] = {"userId": user_id, "kind": "access", "expired": False, "refresh": refresh}
    s.tokens[refresh] = {"userId": user_id, "kind": "refresh", "expired": False}
    return {"accessToken": access, "refreshToken": refresh}


def _attempts(email: str) -> int:
    """Wrong codes for this email in the last 15 minutes; older counts are forgotten."""
    s = S()
    now = now_ms()
    if len(s.otp_attempts) > 1000:
        for key in [k for k, (_, since) in s.otp_attempts.items() if now - since > LOCK_SECONDS * 1000]:
            del s.otp_attempts[key]
    count, since = s.otp_attempts.get(email, (0, now))
    return 0 if now - since > LOCK_SECONDS * 1000 else count


@router.post("/otp/request")
async def otp_request(body: OtpRequest):
    # Asking for a new code must not reset the wrong-code count (it's cleared only on success).
    # Same answer for known and unknown addresses, so nobody can test who has an account.
    return {"sent": True, "resendInSeconds": 30}


@router.post("/otp/verify")
async def otp_verify(body: OtpVerify):
    s = S()
    attempts = _attempts(body.email)
    if attempts >= MAX_ATTEMPTS:
        raise ApiError("OTP_TOO_MANY_ATTEMPTS", "Too many wrong codes. Request a new code.")
    user = next((u for u in s.users.values() if u["email"] == body.email and u["isActive"] and u["id"] != s.bot_id), None)
    if body.code != DEMO_OTP or not user:
        since = s.otp_attempts.get(body.email, (0, now_ms()))[1] if attempts else now_ms()
        s.otp_attempts[body.email] = (attempts + 1, since)
        if attempts + 1 >= MAX_ATTEMPTS:
            raise ApiError("OTP_TOO_MANY_ATTEMPTS", "Too many wrong codes. Request a new code.")
        raise ApiError("OTP_INVALID", "That code is not right.", {"attemptsLeft": MAX_ATTEMPTS - attempts - 1})
    s.otp_attempts.pop(body.email, None)
    bot.on_login(user["id"])
    return {**issue_tokens(user["id"]), **me_view(user)}


@router.post("/refresh")
async def refresh(body: Refresh):
    user = user_for_token(body.refreshToken, kind="refresh")
    s = S()
    # Each refresh replaces that session's previous access token, so tokens don't pile up.
    for old in [k for k, t in s.tokens.items() if t.get("refresh") == body.refreshToken]:
        del s.tokens[old]
    access = new_token("at")
    s.tokens[access] = {"userId": user["id"], "kind": "access", "expired": False, "refresh": body.refreshToken}
    return {"accessToken": access}


@router.post("/logout")
async def logout(user: dict = Depends(current_user)):
    end_sessions(user["id"])
    return {"loggedOut": True}
