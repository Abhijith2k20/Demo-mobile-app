"""Sign-in (spec §5.1, §9.4): a one-time code to a work email or phone, then a session for one company."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from .. import config, db
from ..core import ApiError
from ..deps import current_account, language
from ..rules import job_title_info, localized
from ..schemas import CodeRequest, CodeVerify, PickCompany, Refresh
from ..services import accounts
from ..store import person
from ..views import me_view

router = APIRouter(prefix="/auth", tags=["auth"])


def _company_session(user_id: str, company_id: str) -> dict:
    """Tokens and profile for one company (the caller checked the membership)."""
    tokens = accounts.create_session(user_id, company_id)
    db.current().set_company(company_id)
    return {**tokens, **me_view(person(user_id))}


def _choices(user: dict) -> dict:
    return {"companies": accounts.companies_for(user["id"]), "invites": accounts.invites_for(user)}


@router.post("/otp/request")
def otp_request(body: CodeRequest, request: Request):
    identifier = accounts.normalize_identifier(body.identifier)
    accounts.request_code(identifier, request.client.host if request.client else "?")
    # Same answer for known and unknown addresses, so nobody can test who has an account.
    return {"sent": True, "resendInSeconds": 30, "channel": "sms" if accounts.is_phone(identifier) else "email"}


@router.post("/otp/verify")
def otp_verify(body: CodeVerify):
    """The person's companies and invites. With exactly one company and no invites, its session too."""
    identifier = accounts.normalize_identifier(body.identifier)
    accounts.check_code(identifier, body.code)
    user = accounts.account_for(identifier)
    choices = _choices(user)
    out = {"accessToken": accounts.create_session(user["id"], None)["accessToken"], **choices,
           "user": {"id": user["id"], "name": user["name"]}}
    if len(choices["companies"]) == 1 and not choices["invites"]:
        out["session"] = _company_session(user["id"], choices["companies"][0]["id"])
    return out


@router.get("/companies")
def companies(user: dict = Depends(current_account)):
    """For the company picker and switcher."""
    return _choices(user)


@router.post("/session")
@router.post("/switch")
def pick_company(body: PickCompany, user: dict = Depends(current_account)):
    """A session for one of the person's companies; the session that asked ends (switching company)."""
    m = accounts.membership(user["id"], body.companyId)
    if not m or m["status"] != "active":
        raise ApiError("NOT_A_MEMBER", "You're not in this company.")
    if m["companyStatus"] != "active":
        raise ApiError("COMPANY_SUSPENDED", "This company isn't available on Siteline right now.")
    out = _company_session(user["id"], body.companyId)
    accounts.revoke_session(user["sessionId"])
    return out


@router.post("/invites/{invite_id}/accept")
def accept_invite(invite_id: str, user: dict = Depends(current_account)):
    invite = accounts.accept_invite(user, invite_id)
    return {**_choices(user), "joined": invite["companyId"]}


@router.post("/invites/{invite_id}/decline")
def decline_invite(invite_id: str, user: dict = Depends(current_account)):
    accounts.decline_invite(user, invite_id)
    return _choices(user)


@router.post("/refresh")
def refresh(body: Refresh):
    out = accounts.refresh_session(body.refreshToken)
    return {"accessToken": out["accessToken"], "refreshToken": out["refreshToken"]}


@router.post("/logout")
def logout(user: dict = Depends(current_account)):
    accounts.revoke_session(user["sessionId"])
    return {"loggedOut": True}


@router.get("/demo-accounts")
def demo_accounts(lang: str = Depends(language)):
    """Development and staging only: one sign-in per role in each seeded company (the code is fixed there)."""
    if not config.DEV_TOOLS:
        raise ApiError("NOT_FOUND", "Not found.")
    picked = []
    for c in db.rows("SELECT id, name, setup FROM companies WHERE status = 'active' ORDER BY created_at"):
        db.current().set_company(c["id"])
        seen = set()
        for u in db.rows("""SELECT u.id, u.name, u.email, u.phone, m.role,
                              (SELECT job_title FROM project_members pm WHERE pm.user_id = u.id ORDER BY joined_at LIMIT 1) AS title
                            FROM memberships m JOIN users u ON u.id = m.user_id
                            WHERE m.company_id = %(c)s AND m.status = 'active' ORDER BY m.joined_at, u.id""", c=c["id"]):
            key = u["role"] if u["role"] != "member" else f"member:{u['title']}"
            if key in seen or (u["role"] == "member" and not u["title"]):
                continue
            seen.add(key)
            info = job_title_info(c["setup"], u["title"]) if u["title"] else None
            picked.append({"identifier": u["email"] or u["phone"], "email": u["email"], "name": u["name"],
                           "companyRole": u["role"], "company": c["name"],
                           "jobTitle": localized(info["label"], lang) if info else None})
    db.current().set_company(None)
    return {"accounts": picked}
