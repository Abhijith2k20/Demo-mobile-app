"""The Siteline team's side (spec §9.2, §10.8): create, suspend and look after companies. Two ways in:
- POST /platform/companies with the X-Platform-Key header (a script, later the PM app);
- the panel at /platform: server-rendered pages for emails in `platform_admins`, signed in with a code.
Nothing here shows a company's messages or files. Every action is written to the audit log."""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import secrets
import time
from datetime import date

from fastapi import APIRouter, Cookie, Form, Header, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from .. import config, db
from ..core import ApiError, uuid7
from ..jobs.queue import enqueue
from ..pm import mock
from ..schemas import CompanyCreate
from ..services import accounts, companies

router = APIRouter(prefix="/platform", tags=["platform"])
COOKIE = "siteline_platform"
SESSION_SECONDS = 8 * 60 * 60


# ---- API ----

@router.post("/companies")
def api_create_company(body: CompanyCreate, x_platform_key: str = Header("")):
    if not config.PLATFORM_KEY or not hmac.compare_digest(x_platform_key, config.PLATFORM_KEY):
        raise ApiError("FORBIDDEN", "A valid X-Platform-Key is needed.")
    c = companies.create(name=body.name, time_zone=body.timeZone, template=body.template, owner_name=body.ownerName,
                         owner_identifier=body.ownerIdentifier, actor="platform-api", pm_kind=body.pmKind,
                         pm_company_id=body.pmCompanyId, pm_base_url=body.pmBaseUrl, pm_api_key=body.pmApiKey,
                         pm_webhook_secret=body.pmWebhookSecret)
    return {"company": {"id": c["id"], "name": c["name"], "slug": c["slug"]}}


# ---- Panel sign-in ----

def _sign(value: str) -> str:
    return hmac.new(config.SECRET.encode(), f"platform:{value}".encode(), hashlib.sha256).hexdigest()


def _admin(cookie: str | None) -> str | None:
    """The signed-in platform admin's email, or None."""
    try:
        email, exp, sig = (cookie or "").split("|")
    except ValueError:
        return None
    if int(exp) < time.time() or not hmac.compare_digest(sig, _sign(f"{email}|{exp}")):
        return None
    return email if db.value("SELECT 1 FROM platform_admins WHERE email = %(e)s", e=email) else None


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{html.escape(title)} · Siteline platform</title><style>
body{{font:15px/1.45 system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#1d1c1d}}
h1{{font-size:22px}} h2{{font-size:17px;margin-top:28px}} table{{border-collapse:collapse;width:100%}}
td,th{{border-bottom:1px solid #e2e4e7;padding:6px 8px;text-align:left;vertical-align:top}}
input,select,textarea{{font:inherit;padding:5px 7px;border:1px solid #c9ccd1;border-radius:6px}}
button{{font:inherit;padding:6px 12px;border:0;border-radius:6px;background:#1667b0;color:#fff;cursor:pointer}}
button.quiet{{background:#e2e4e7;color:#1d1c1d}} .err{{color:#b8423a}} .muted{{color:#616061}} form.inline{{display:inline}}
label{{display:block;margin:6px 0}}</style></head><body><p class="muted"><a href="/platform">Siteline platform</a></p>
{body}</body></html>""")


def _e(v) -> str:
    return html.escape("" if v is None else str(v))


@router.get("", response_class=HTMLResponse)
def panel(siteline_platform: str | None = Cookie(None), error: str = ""):
    admin = _admin(siteline_platform)
    if not admin:
        return _page("Sign in", f"""<h1>Sign in</h1><p class="err">{_e(error)}</p>
<form method="post" action="/platform/login"><label>Email <input name="email" type="email" required></label>
<button>Send code</button></form>""")
    rows = db.rows("""SELECT c.*, (SELECT count(*) FROM memberships m WHERE m.company_id = c.id AND m.status = 'active') AS people,
                      l.kind AS pm_kind, l.last_sync_at, l.last_error FROM companies c LEFT JOIN pm_links l ON l.company_id = c.id
                      ORDER BY c.created_at DESC""")
    table = "".join(f"""<tr><td><a href="/platform/companies/{_e(c['id'])}">{_e(c['name'])}</a></td><td>{_e(c['status'])}</td>
<td>{c['people']}</td><td>{_e(c['pmKind'])}</td><td>{_e(c['lastSyncAt'])}</td><td class="err">{_e(c['lastError'])}</td></tr>"""
                    for c in rows)
    return _page("Companies", f"""<h1>Companies</h1><p class="muted">Signed in as {_e(admin)} ·
<a href="/platform/audit">Audit log</a></p><p class="err">{_e(error)}</p>
<table><tr><th>Company</th><th>Status</th><th>People</th><th>PM link</th><th>Last sync</th><th>Last error</th></tr>{table}</table>
<h2>New company</h2><form method="post" action="/platform/companies/new">
<label>Name <input name="name" required></label>
<label>Time zone <input name="time_zone" value="Asia/Kolkata" required></label>
<label>Template <select name="template"><option>general</option><option>interiors</option><option>events</option></select></label>
<label>Owner's name <input name="owner_name" required></label>
<label>Owner's email or phone <input name="owner_identifier" required></label>
<label>PM company id <input name="pm_company_id"></label>
<label>PM link <select name="pm_kind"><option value="mock">Mock PM app</option><option value="http">PM app API</option>
<option value="none">None (projects made in Siteline)</option></select></label>
<label>PM API address <input name="pm_base_url"></label><label>PM API key <input name="pm_api_key" type="password"></label>
<label>PM webhook secret <input name="pm_webhook_secret" type="password"></label>
<button>Create company and invite owner</button></form>""")


@router.post("/login", response_class=HTMLResponse)
def login(request: Request, email: str = Form(...)):
    email = email.strip().lower()
    ip = request.client.host if request.client else "?"
    if db.value("SELECT count(*) FROM otp_requests WHERE ip = %(ip)s AND at > now() - interval '1 hour'", ip=ip) >= 20:
        return RedirectResponse("/platform?error=Too+many+tries.+Wait+an+hour.", status_code=303)
    db.run("INSERT INTO otp_requests (identifier, ip) VALUES (%(v)s, %(ip)s)", v="platform:" + email, ip=ip)
    if db.value("SELECT 1 FROM platform_admins WHERE email = %(e)s", e=email):
        code = config.FIXED_CODE or f"{secrets.randbelow(1_000_000):06d}"
        db.run("""INSERT INTO otp_codes (identifier, code_hash, expires_at) VALUES (%(v)s, %(h)s, now() + interval '10 minutes')
                  ON CONFLICT (identifier) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
                  attempts = 0""", v="platform:" + email, h=accounts._hash("platform:" + email + code))
        enqueue("send_code", {"identifier": email, "code": code}, company_id=None)
    return _page("Code", f"""<h1>Enter the code</h1><p class="muted">If {_e(email)} is a platform admin, a code is on its way.</p>
<form method="post" action="/platform/verify"><input type="hidden" name="email" value="{_e(email)}">
<label>Code <input name="code" inputmode="numeric" maxlength="6" required></label><button>Sign in</button></form>""")


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
                        secure=config.PRODUCTION, path="/platform")
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
                 template: str = Form(...), owner_name: str = Form(...), owner_identifier: str = Form(...),
                 pm_company_id: str = Form(""), pm_kind: str = Form("mock"), pm_base_url: str = Form(""),
                 pm_api_key: str = Form(""), pm_webhook_secret: str = Form("")):
    admin = _require(siteline_platform)
    try:
        body = CompanyCreate(name=name, timeZone=time_zone, template=template, ownerName=owner_name,
                             ownerIdentifier=owner_identifier, pmKind=pm_kind)
        c = companies.create(name=body.name, time_zone=body.timeZone, template=body.template, owner_name=body.ownerName,
                             owner_identifier=body.ownerIdentifier, actor=admin, pm_kind=pm_kind,
                             pm_company_id=pm_company_id or None, pm_base_url=pm_base_url or None,
                             pm_api_key=pm_api_key or None, pm_webhook_secret=pm_webhook_secret or None)
    except (ApiError, ValueError) as e:
        msg = getattr(e, "details", {}).get("fields") or str(e)
        return RedirectResponse(f"/platform?error={html.escape(str(msg))[:200].replace(' ', '+')}", status_code=303)
    return _back(c["id"], "Company created. The owner's invite is on its way.")


@router.get("/companies/{company_id}", response_class=HTMLResponse)
def company_page(company_id: str, siteline_platform: str | None = Cookie(None), note: str = ""):
    _require(siteline_platform)
    c = db.row("SELECT * FROM companies WHERE id = %(c)s", c=company_id)
    if not c:
        return RedirectResponse("/platform?error=No+such+company", status_code=303)
    link = db.row("SELECT * FROM pm_links WHERE company_id = %(c)s", c=company_id) or {}
    members = db.rows("""SELECT u.id, u.name, u.email, u.phone, m.role, m.status FROM memberships m JOIN users u ON u.id = m.user_id
                         WHERE m.company_id = %(c)s ORDER BY m.role, u.name""", c=company_id)
    invites = db.rows("""SELECT identifier, name, role, expires_at FROM invites WHERE company_id = %(c)s AND status = 'pending'
                         ORDER BY created_at DESC""", c=company_id)
    people = "".join(f"<tr><td>{_e(m['name'])}</td><td>{_e(m['email'] or m['phone'])}</td><td>{_e(m['role'])}</td>"
                     f"<td>{_e(m['status'])}</td></tr>" for m in members)
    pending = "".join(f"<tr><td>{_e(i['name'])}</td><td>{_e(i['identifier'])}</td><td>{_e(i['role'])}</td>"
                      f"<td>{_e(i['expiresAt'])}</td></tr>" for i in invites)
    options = "".join(f'<option value="{_e(m["id"])}">{_e(m["name"])}</option>' for m in members
                      if m["status"] == "active" and m["role"] != "owner")
    flip = "suspended" if c["status"] == "active" else "active"
    mock_section = _mock_section(company_id) if link.get("kind") == "mock" else ""
    return _page(c["name"], f"""<h1>{_e(c['name'])}</h1><p class="muted">{_e(c['status'])} · {_e(c['timeZone'])} ·
PM company {_e(c['pmCompanyId'])}</p><p>{_e(note)}</p>
<form class="inline" method="post" action="/platform/companies/{_e(company_id)}/status"><input type="hidden" name="status" value="{flip}">
<button class="quiet">{'Suspend' if flip == 'suspended' else 'Make active again'}</button></form>
<h2>People</h2><table><tr><th>Name</th><th>Email or phone</th><th>Role</th><th>Status</th></tr>{people}</table>
<h2>Pending invites</h2><table><tr><th>Name</th><th>Email or phone</th><th>Role</th><th>Expires</th></tr>{pending}</table>
<form method="post" action="/platform/companies/{_e(company_id)}/owner-invite"><label>Invite a new owner: name
<input name="name" required> email or phone <input name="identifier" required></label><button class="quiet">Send owner invite</button></form>
<form method="post" action="/platform/companies/{_e(company_id)}/transfer"><label>Transfer ownership to
<select name="user_id">{options}</select></label><button class="quiet">Transfer</button></form>
<h2>PM link</h2><p class="muted">Last sync {_e(link.get('lastSyncAt'))} <span class="err">{_e(link.get('lastError'))}</span>
· Not on Siteline yet: {_e(', '.join((link.get('options') or {}).get('unmatched', [])))}</p>
<form method="post" action="/platform/companies/{_e(company_id)}/pm-link">
<label>Kind <select name="kind"><option value="mock" {'selected' if link.get('kind') == 'mock' else ''}>Mock PM app</option>
<option value="http" {'selected' if link.get('kind') == 'http' else ''}>PM app API</option></select></label>
<label>PM company id <input name="pm_company_id" value="{_e(c['pmCompanyId'])}"></label>
<label>API address <input name="base_url" value="{_e(link.get('baseUrl'))}"></label>
<label>API key (leave empty to keep) <input name="api_key" type="password"></label>
<label>Webhook secret (leave empty to keep) <input name="webhook_secret" type="password"></label>
<p class="muted">Webhooks go to {_e(config.PUBLIC_URL)}/webhooks/pm/{_e(company_id)}</p>
<button>Save and sync</button></form>
<form method="post" action="/platform/companies/{_e(company_id)}/sync"><button class="quiet">Sync now</button></form>
<h2>Setup</h2><form method="post" action="/platform/companies/{_e(company_id)}/setup">
<textarea name="setup" rows="18" style="width:100%;font-family:monospace">{_e(json.dumps(c['setup'], indent=2, ensure_ascii=False))}</textarea>
<button>Save setup</button></form>{mock_section}""")


def _mock_section(company_id: str) -> str:
    t = db.current()
    previous = t.company_id
    t.set_company(company_id)
    try:
        projects = db.rows("SELECT * FROM pm_mock_projects ORDER BY name")
        tasks = db.rows("SELECT * FROM pm_mock_tasks WHERE deleted_at IS NULL ORDER BY project_id, planned_start, name")
        down = bool(db.value("SELECT (options->>'down')::boolean FROM pm_links WHERE company_id = %(c)s", c=company_id))
    finally:
        t.set_company(previous)
    names = {p["id"]: p["name"] for p in projects}
    project_opts = "".join(f'<option value="{_e(p["id"])}">{_e(p["name"])}</option>' for p in projects)
    statuses = ("not_started", "in_progress", "blocked", "done")
    rows = "".join(f"""<tr><form method="post" action="/platform/companies/{_e(company_id)}/mock/tasks">
<input type="hidden" name="id" value="{_e(t['id'])}"><input type="hidden" name="project_id" value="{_e(t['projectId'])}">
<td>{_e(names.get(t['projectId']))}</td><td><input name="name" value="{_e(t['name'])}" size="22"></td>
<td><input name="planned_start" type="date" value="{_e(t['plannedStart'])}"></td>
<td><input name="planned_finish" type="date" value="{_e(t['plannedFinish'])}"></td>
<td><input name="owner_ref" value="{_e(t['ownerRef'])}" size="16"></td>
<td><select name="status">{''.join(f'<option {"selected" if s == t["status"] else ""}>{s}</option>' for s in statuses)}</select></td>
<td><input name="percent" type="number" min="0" max="100" value="{t['percent']}" style="width:58px"></td>
<td><button class="quiet">Save</button></td></form>
<td><form method="post" action="/platform/companies/{_e(company_id)}/mock/tasks/{_e(t['id'])}/delete"><button class="quiet">Remove</button></form></td></tr>"""
                   for t in tasks)
    project_rows = "".join(f"""<li>{_e(p['name'])} ({_e(p['status'])})
<form class="inline" method="post" action="/platform/companies/{_e(company_id)}/mock/projects/{_e(p['id'])}">
<input type="hidden" name="status" value="{'closed' if p['status'] == 'active' else 'active'}">
<button class="quiet">{'Close' if p['status'] == 'active' else 'Reopen'}</button></form></li>""" for p in projects)
    return f"""<h2>Mock PM app</h2><p class="muted">Stands in for this company's PM app. Changes here reach Siteline as webhooks.</p>
<form method="post" action="/platform/companies/{_e(company_id)}/mock/down"><input type="hidden" name="down" value="{'0' if down else '1'}">
<button class="quiet">{'Bring the mock PM app back' if down else 'Make the mock PM app stop answering'}</button></form>
<ul>{project_rows}</ul>
<table><tr><th>Project</th><th>Task</th><th>Start</th><th>Finish</th><th>Owner (email/phone)</th><th>Status</th><th>%</th><th></th><th></th></tr>
{rows}<tr><form method="post" action="/platform/companies/{_e(company_id)}/mock/tasks"><input type="hidden" name="id" value="">
<td><select name="project_id">{project_opts}</select></td><td><input name="name" placeholder="New task" size="22" required></td>
<td><input name="planned_start" type="date" value="{date.today()}"></td><td><input name="planned_finish" type="date" value="{date.today()}"></td>
<td><input name="owner_ref" size="16"></td><td><select name="status">{''.join(f'<option>{s}</option>' for s in statuses)}</select></td>
<td><input name="percent" type="number" value="0" style="width:58px"></td><td><button>Add</button></td></form><td></td></tr></table>"""


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


@router.post("/companies/{company_id}/setup")
def save_setup(company_id: str, setup: str = Form(...), siteline_platform: str | None = Cookie(None)):
    admin = _require(siteline_platform)
    try:
        companies.update_setup(company_id, json.loads(setup), admin)
    except (ValueError, ApiError) as e:
        return _back(company_id, f"Setup not saved: {getattr(e, 'details', {}).get('fields') or e}")
    return _back(company_id, "Setup saved.")


@router.post("/companies/{company_id}/pm-link")
def save_pm_link(company_id: str, kind: str = Form(...), base_url: str = Form(""), api_key: str = Form(""),
                 webhook_secret: str = Form(""), pm_company_id: str = Form(""), siteline_platform: str | None = Cookie(None)):
    companies.update_pm_link(company_id, kind=kind, base_url=base_url or None, api_key=api_key or None,
                             webhook_secret=webhook_secret or None, pm_company_id=pm_company_id or None,
                             actor=_require(siteline_platform))
    return _back(company_id, "PM link saved; a sync is queued.")


@router.post("/companies/{company_id}/sync")
def sync_now(company_id: str, siteline_platform: str | None = Cookie(None)):
    _require(siteline_platform)
    enqueue("pm_sync", {}, company_id=company_id)
    return _back(company_id, "Sync queued.")


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
    _require(siteline_platform)
    rows = db.rows("""SELECT a.*, c.name AS company FROM audit_log a LEFT JOIN companies c ON c.id = a.company_id
                      ORDER BY a.at DESC LIMIT 300""")
    body = "".join(f"<tr><td>{_e(r['at'])}</td><td>{_e(r['company'])}</td><td>{_e(r['actor'])}</td><td>{_e(r['action'])}</td>"
                   f"<td>{_e(r['target'])}</td></tr>" for r in rows)
    return _page("Audit log", f"<h1>Audit log</h1><table><tr><th>When</th><th>Company</th><th>Who</th><th>What</th>"
                              f"<th>Target</th></tr>{body}</table>")
