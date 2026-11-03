"""The Siteline team's side (spec §9.2, §10.8): create, suspend and look after companies. Two ways in:
- POST /platform/companies with the X-Platform-Key header (a script, later the PM app);
- the panel at /platform: server-rendered pages for emails in `platform_admins`, signed in with a code.
Nothing here shows a company's messages or files. Every action is written to the audit log."""
from __future__ import annotations

import hashlib
import hmac
import html
import secrets
import time

from fastapi import APIRouter, Cookie, Form, Header, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from .. import config, db
from ..core import ApiError, uuid7
from ..jobs.queue import enqueue
from ..mockpm import data as mock
from ..deps import client_ip
from ..schemas import CompanyCreate
from ..services import accounts, companies, integrations
from ..platform_ui import render

router = APIRouter(prefix="/platform", tags=["platform"])
COOKIE = "siteline_platform"
SESSION_SECONDS = 8 * 60 * 60


# ---- API ----

@router.post("/companies")
def api_create_company(body: CompanyCreate, x_platform_key: str = Header("")):
    if not config.PLATFORM_KEY or not hmac.compare_digest(x_platform_key, config.PLATFORM_KEY):
        raise ApiError("FORBIDDEN", "A valid X-Platform-Key is needed.")
    c = companies.create(name=body.name, time_zone=body.timeZone, owner_name=body.ownerName,
                         owner_identifier=body.ownerIdentifier, actor="platform-api", pm_kind=body.pmKind,
                         pm_company_id=body.pmCompanyId, webhook_url=body.pmWebhookUrl)
    return {"company": {"id": c["id"], "name": c["name"], "slug": c["slug"]}}


# ---- Panel sign-in ----

def _sign(value: str) -> str:
    return hmac.new(config.SECRET.encode(), f"platform:{value}".encode(), hashlib.sha256).hexdigest()


def _admin(cookie: str | None) -> str | None:
    """The signed-in platform admin's email, or None."""
    try:
        email, exp, sig = (cookie or "").split("|")
        expires = int(exp)
    except ValueError:  # a damaged or hand-made cookie is simply "not signed in"
        return None
    if expires < time.time() or not hmac.compare_digest(sig, _sign(f"{email}|{exp}")):
        return None
    return email if db.value("SELECT 1 FROM platform_admins WHERE email = %(e)s", e=email) else None


@router.get("", response_class=HTMLResponse)
def panel(siteline_platform: str | None = Cookie(None), error: str = ""):
    admin = _admin(siteline_platform)
    if not admin:
        return render("signin.html", title="Sign in", error=error)
    rows = db.rows("""SELECT c.*, (SELECT count(*) FROM memberships m WHERE m.company_id = c.id AND m.status = 'active') AS people,
                      l.kind AS pm_kind, l.last_call_at, l.last_error FROM companies c LEFT JOIN integrations l ON l.company_id = c.id
                      ORDER BY c.created_at DESC""")
    return render("companies.html", title="Companies", admin=admin, nav="companies", rows=rows, error=error,
                  active=sum(1 for c in rows if c["status"] == "active"), people=sum(c["people"] for c in rows))


@router.post("/login", response_class=HTMLResponse)
def login(request: Request, email: str = Form(...)):
    email = email.strip().lower()
    ip = client_ip(request)
    if db.value("SELECT count(*) FROM otp_requests WHERE ip = %(ip)s AND at > now() - interval '1 hour'", ip=ip) >= 20:
        return RedirectResponse("/platform?error=Too+many+tries.+Wait+an+hour.", status_code=303)
    db.run("INSERT INTO otp_requests (identifier, ip) VALUES (%(v)s, %(ip)s)", v="platform:" + email, ip=ip)
    if db.value("SELECT 1 FROM platform_admins WHERE email = %(e)s", e=email):
        # The demo code never opens the panel outside local development (staging is on the internet).
        code = (config.fixed_code_for(email) if config.DEVELOPMENT else None) or f"{secrets.randbelow(1_000_000):06d}"
        db.run("""INSERT INTO otp_codes (identifier, code_hash, expires_at) VALUES (%(v)s, %(h)s, now() + interval '10 minutes')
                  ON CONFLICT (identifier) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
                  attempts = 0""", v="platform:" + email, h=accounts._hash("platform:" + email + code))
        enqueue("send_code", {"identifier": email, "code": code}, company_id=None)
    return render("code.html", title="Enter code", email=email)


@router.post("/verify")
def verify(email: str = Form(...), code: str = Form(...)):
    email = email.strip().lower()
    try:
        accounts.check_code("platform:" + email, code.strip())
    except ApiError as e:
        return RedirectResponse(f"/platform?error={e.message.replace(' ', '+')}", status_code=303)
    exp = int(time.time()) + SESSION_SECONDS
    value = f"{email}|{exp}"
    response = RedirectResponse("/platform", status_code=303)
    response.set_cookie(COOKIE, f"{value}|{_sign(value)}", max_age=SESSION_SECONDS, httponly=True, samesite="strict",
                        secure=not config.DEVELOPMENT, path="/platform")
    accounts.audit(None, email, "platform.signed_in")
    return response


def _require(cookie: str | None) -> str:
    admin = _admin(cookie)
    if not admin:
        raise ApiError("AUTH_EXPIRED", "Sign in to the platform panel.")
    return admin


def _back(company_id: str, note: str = "") -> RedirectResponse:
    return RedirectResponse(f"/platform/companies/{company_id}?note={note.replace(' ', '+')}", status_code=303)


@router.post("/companies/new")
def panel_create(siteline_platform: str | None = Cookie(None), name: str = Form(...), time_zone: str = Form(...),
                 owner_name: str = Form(...), owner_identifier: str = Form(...),
                 pm_company_id: str = Form(""), pm_kind: str = Form("mock"), pm_webhook_url: str = Form("")):
    admin = _require(siteline_platform)
    try:
        body = CompanyCreate(name=name, timeZone=time_zone, ownerName=owner_name,
                             ownerIdentifier=owner_identifier, pmKind=pm_kind)
        c = companies.create(name=body.name, time_zone=body.timeZone, owner_name=body.ownerName,
                             owner_identifier=body.ownerIdentifier, actor=admin, pm_kind=pm_kind,
                             pm_company_id=pm_company_id or None, webhook_url=pm_webhook_url or None)
    except (ApiError, ValueError) as e:
        msg = getattr(e, "details", {}).get("fields") or str(e)
        return RedirectResponse(f"/platform?error={html.escape(str(msg))[:200].replace(' ', '+')}", status_code=303)
    return _back(c["id"], "Company created. The owner's invite is on its way.")


@router.get("/companies/{company_id}", response_class=HTMLResponse)
def company_page(company_id: str, siteline_platform: str | None = Cookie(None), note: str = ""):
    admin = _require(siteline_platform)
    c = db.row("SELECT * FROM companies WHERE id = %(c)s", c=company_id)
    if not c:
        return RedirectResponse("/platform?error=No+such+company", status_code=303)
    link = db.row("SELECT * FROM integrations WHERE company_id = %(c)s", c=company_id) or {}
    members = db.rows("""SELECT u.id, u.name, u.email, m.role, m.status FROM memberships m JOIN users u ON u.id = m.user_id
                         WHERE m.company_id = %(c)s ORDER BY m.status, array_position(ARRAY['owner','admin','member','guest'], m.role), u.name""", c=company_id)
    invites = db.rows("""SELECT identifier, name, role, expires_at FROM invites WHERE company_id = %(c)s AND status = 'pending'
                         ORDER BY created_at DESC""", c=company_id)
    return render("company.html", title=c["name"], admin=admin, nav="companies", c=c, link=link, members=members, invites=invites,
                  note=note, public_url=config.PUBLIC_URL, active_count=sum(1 for m in members if m["status"] == "active"),
                  transferable=[m for m in members if m["status"] == "active" and m["role"] != "owner"],
                  mock=_mock_data(company_id) if link.get("kind") == "mock" else None)


def _mock_data(company_id: str) -> dict:
    """The mock PM app's projects and tasks for one company (its tables are per company)."""
    t = db.current()
    previous = t.company_id
    t.set_company(company_id)
    try:
        projects = db.rows("SELECT * FROM pm_mock_projects ORDER BY name")
        tasks = db.rows("SELECT * FROM pm_mock_tasks WHERE deleted_at IS NULL ORDER BY project_id, planned_start, name")
        down = mock.is_down()
    finally:
        t.set_company(previous)
    return {"projects": projects, "tasks": tasks, "down": down, "names": {p["id"]: p["name"] for p in projects}}


@router.post("/companies/{company_id}/status")
def set_status(company_id: str, status: str = Form(...), siteline_platform: str | None = Cookie(None)):
    companies.set_status(company_id, status, _require(siteline_platform))
    return _back(company_id, f"Company is now {status}.")


@router.post("/companies/{company_id}/owner-invite")
def owner_invite(company_id: str, name: str = Form(...), identifier: str = Form(...), siteline_platform: str | None = Cookie(None)):
    companies.invite_owner(company_id, name, accounts.normalize_identifier(identifier), _require(siteline_platform))
    return _back(company_id, "Owner invite sent.")


@router.post("/companies/{company_id}/transfer")
def transfer(company_id: str, user_id: str = Form(...), siteline_platform: str | None = Cookie(None)):
    companies.transfer_ownership(company_id, user_id, _require(siteline_platform))
    return _back(company_id, "Ownership transferred.")


@router.post("/companies/{company_id}/pm-link")
def save_pm_link(company_id: str, kind: str = Form(...), webhook_url: str = Form(""), pm_company_id: str = Form(""),
                 card_seen: str = Form(""), siteline_platform: str | None = Cookie(None)):
    companies.update_pm_link(company_id, kind=kind, webhook_url=webhook_url or None, pm_company_id=pm_company_id or None,
                             card_seen=card_seen == "1", actor=_require(siteline_platform))
    return _back(company_id, "PM link saved.")


@router.post("/companies/{company_id}/pm-key", response_class=HTMLResponse)
def new_pm_key(company_id: str, siteline_platform: str | None = Cookie(None)):
    """Shown once: the PM team copies them now. The old key keeps working for 24 hours."""
    admin = _require(siteline_platform)
    if not db.value("SELECT 1 FROM integrations WHERE company_id = %(c)s", c=company_id):
        return _back(company_id, "Save a PM link first.")
    creds = integrations.new_credentials(company_id)
    accounts.audit(company_id, admin, "pm_key.created", company_id)
    return render("api_key.html", title="New API key", admin=admin, nav="companies", company_id=company_id, creds=creds)


def _as_company(company_id: str):
    db.current().set_company(company_id)


@router.post("/companies/{company_id}/mock/tasks")
def mock_save_task(company_id: str, id: str = Form(""), project_id: str = Form(...), name: str = Form(...),
                   planned_start: str = Form(...), planned_finish: str = Form(...), owner_ref: str = Form(""),
                   status: str = Form("not_started"), percent: int = Form(0), siteline_platform: str | None = Cookie(None)):
    admin = _require(siteline_platform)
    _as_company(company_id)
    mock.save_task({"id": id or uuid7(), "projectId": project_id, "name": name, "plannedStart": planned_start,
                    "plannedFinish": max(planned_start, planned_finish), "ownerRef": owner_ref.strip() or None,
                    "status": status, "percent": max(0, min(100, percent))})
    accounts.audit(company_id, admin, "mock.task_saved", id or name)
    return _back(company_id, "Task saved in the mock PM app.")


@router.post("/companies/{company_id}/mock/tasks/{task_id}/delete")
def mock_delete_task(company_id: str, task_id: str, siteline_platform: str | None = Cookie(None)):
    admin = _require(siteline_platform)
    _as_company(company_id)
    mock.delete_task(task_id)
    accounts.audit(company_id, admin, "mock.task_removed", task_id)
    return _back(company_id, "Task removed from the mock PM app.")


@router.post("/companies/{company_id}/mock/projects/{project_id}")
def mock_project(company_id: str, project_id: str, status: str = Form(...), siteline_platform: str | None = Cookie(None)):
    admin = _require(siteline_platform)
    _as_company(company_id)
    mock.set_project_status(project_id, "closed" if status == "closed" else "active")
    accounts.audit(company_id, admin, "mock.project_status", project_id, {"status": status})
    return _back(company_id, "Project updated in the mock PM app.")


@router.post("/companies/{company_id}/mock/down")
def mock_down(company_id: str, down: str = Form(...), siteline_platform: str | None = Cookie(None)):
    _require(siteline_platform)
    _as_company(company_id)
    mock.set_down(down == "1")
    return _back(company_id, "The mock PM app is down." if down == "1" else "The mock PM app is answering again.")


@router.get("/audit", response_class=HTMLResponse)
def audit(siteline_platform: str | None = Cookie(None)):
    admin = _require(siteline_platform)
    rows = db.rows("""SELECT a.*, c.name AS company, u.name AS actor_name FROM audit_log a
                      LEFT JOIN companies c ON c.id = a.company_id LEFT JOIN users u ON u.id = a.actor
                      ORDER BY a.at DESC LIMIT 300""")
    return render("audit.html", title="Audit log", admin=admin, nav="audit", rows=rows)
