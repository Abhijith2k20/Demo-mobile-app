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
from datetime import date

from fastapi import APIRouter, Cookie, Form, Header, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from .. import config, db
from ..core import ApiError, uuid7
from ..jobs.queue import enqueue
from ..mockpm import data as mock
from ..deps import client_ip
from ..schemas import CompanyCreate
from ..services import accounts, companies, integrations
from ..platform_ui import PM_KINDS, auth_card, card, confirm, e as _e, empty, flash, page, pill, when

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
        return page("Sign in", auth_card("Sign in to Siteline Platform", "For the Siteline team. We'll email you a 6-digit code.",
                                         """<form method="post" action="/platform/login">
<label class="f">Work email<input name="email" type="email" autocomplete="email" placeholder="name@company.com" required autofocus></label>
<div class="actions"><button class="btn full">Send code</button></div></form>""", error))
    rows = db.rows("""SELECT c.*, (SELECT count(*) FROM memberships m WHERE m.company_id = c.id AND m.status = 'active') AS people,
                      l.kind AS pm_kind, l.last_call_at, l.last_error FROM companies c LEFT JOIN integrations l ON l.company_id = c.id
                      ORDER BY c.created_at DESC""")
    table = "".join(f"""<tr><td><a class="strong" href="/platform/companies/{_e(c['id'])}">{_e(c['name'])}</a>
<div class="muted small">{_e(c['slug'])}</div></td><td>{pill(c['status'])}</td><td class="num">{c['people']}</td>
<td>{_e(PM_KINDS.get(c['pmKind'], c['pmKind']) or '—')}</td><td class="muted">{when(c['lastCallAt'], 'Never')}</td>
<td><div class="trunc small" style="color:var(--danger)" title="{_e(c['lastError'])}">{_e(c['lastError'])}</div></td></tr>"""
                    for c in rows) or empty("No companies yet. Create the first one below.", 6)
    active = sum(1 for c in rows if c["status"] == "active")
    people = sum(c["people"] for c in rows)
    zones = "".join(f'<option value="{z}"></option>' for z in ("Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York", "UTC"))
    return page("Companies", f"""<div class="head"><div><h1>Companies</h1>
<p class="sub">{len(rows)} companies · {active} active · {people} people</p></div></div>{flash(error, "bad")}
<section class="card"><div class="scroll"><table><thead><tr><th>Company</th><th>Status</th><th class="num">People</th><th>PM link</th>
<th>Last API call</th><th>Last error</th></tr></thead><tbody>{table}</tbody></table></div></section>
<details class="card" {'open' if error or not rows else ''}><summary>New company</summary>
<form class="body" method="post" action="/platform/companies/new"><div class="fields">
<label class="f">Company name<input name="name" placeholder="Paliath Interiors" required></label>
<label class="f">Time zone<input name="time_zone" value="Asia/Kolkata" list="zones" required><datalist id="zones">{zones}</datalist></label>
<label class="f">Owner's name<input name="owner_name" autocomplete="off" required></label>
<label class="f">Owner's work email<input name="owner_identifier" type="email" placeholder="name@company.com" required></label>
<label class="f">PM link<select name="pm_kind"><option value="mock">Mock PM app</option><option value="http">PM app API</option>
<option value="none">None (projects made in Siteline)</option></select></label>
<label class="f">PM company id <span>Optional. The company's id in the PM app.</span><input name="pm_company_id"></label>
<label class="f wide">PM webhook URL <span>Optional. Where Siteline sends card answers.</span>
<input name="pm_webhook_url" type="url" placeholder="https://pm.example.com/siteline/webhook"></label></div>
<div class="actions"><button class="btn">Create company and invite owner</button>
<span class="muted small">The owner gets an email invite right away.</span></div></form></details>""", admin, "companies")


@router.post("/login", response_class=HTMLResponse)
def login(request: Request, email: str = Form(...)):
    email = email.strip().lower()
    ip = client_ip(request)
    if db.value("SELECT count(*) FROM otp_requests WHERE ip = %(ip)s AND at > now() - interval '1 hour'", ip=ip) >= 20:
        return RedirectResponse("/platform?error=Too+many+tries.+Wait+an+hour.", status_code=303)
    db.run("INSERT INTO otp_requests (identifier, ip) VALUES (%(v)s, %(ip)s)", v="platform:" + email, ip=ip)
    if db.value("SELECT 1 FROM platform_admins WHERE email = %(e)s", e=email):
        code = config.fixed_code_for(email) or f"{secrets.randbelow(1_000_000):06d}"
        db.run("""INSERT INTO otp_codes (identifier, code_hash, expires_at) VALUES (%(v)s, %(h)s, now() + interval '10 minutes')
                  ON CONFLICT (identifier) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
                  attempts = 0""", v="platform:" + email, h=accounts._hash("platform:" + email + code))
        enqueue("send_code", {"identifier": email, "code": code}, company_id=None)
    return page("Enter code", auth_card("Check your email", f"If <b>{_e(email)}</b> is a platform admin, a 6-digit code is on its way. It works for 10 minutes.",
                                       f"""<form method="post" action="/platform/verify"><input type="hidden" name="email" value="{_e(email)}">
<label class="f">Code<input class="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{{6}}" maxlength="6" required autofocus></label>
<div class="actions"><button class="btn full">Sign in</button></div></form>
<p class="small" style="text-align:center;margin:20px 0 0"><a href="/platform">Use a different email</a></p>"""))


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
    cid = _e(company_id)
    people = "".join(f"""<tr><td class="strong">{_e(m['name'])}</td><td class="muted">{_e(m['email']) or '—'}</td>
<td>{_e(m['role'].capitalize())}</td><td>{pill(m['status'])}</td></tr>""" for m in members) or empty("No one yet.", 4)
    pending = "".join(f"""<tr><td class="strong">{_e(i['name'])}</td><td class="muted">{_e(i['identifier'])}</td>
<td>{_e(i['role'].capitalize())}</td><td class="muted">{when(i['expiresAt'])}</td></tr>""" for i in invites) or empty("No pending invites.", 4)
    options = "".join(f'<option value="{_e(m["id"])}">{_e(m["name"])}</option>' for m in members
                      if m["status"] == "active" and m["role"] != "owner")
    active_count = sum(1 for m in members if m["status"] == "active")
    flip = "suspended" if c["status"] == "active" else "active"
    status_form = (f"""<form class="inline" method="post" action="/platform/companies/{cid}/status"
{confirm(f"Suspend {c['name']}? Nobody in it can use Siteline until you make it active again.")}>
<input type="hidden" name="status" value="suspended"><button class="btn danger">Suspend company</button></form>"""
                   if flip == "suspended" else
                   f"""<form class="inline" method="post" action="/platform/companies/{cid}/status">
<input type="hidden" name="status" value="active"><button class="btn">Make active again</button></form>""")
    kind = link.get("kind")
    transfer = (f"""<form method="post" action="/platform/companies/{cid}/transfer"
{confirm("Transfer ownership? The current owner becomes an admin.")}>
<label class="f">Transfer to someone already in the company<select name="user_id">{options}</select></label>
<div class="actions"><button class="btn secondary">Transfer ownership</button></div></form>""" if options else
                '<p class="muted">Transfer needs another active person in the company.</p>')
    pm_form = f"""<form class="body" method="post" action="/platform/companies/{cid}/pm-link"><div class="fields">
<label class="f">Kind<select name="kind"><option value="mock" {'selected' if kind == 'mock' else ''}>Mock PM app</option>
<option value="http" {'selected' if kind == 'http' else ''}>PM app API</option></select></label>
<label class="f">PM company id<input name="pm_company_id" value="{_e(c['pmCompanyId'])}"></label>
<label class="f wide">Webhook URL <span>Card answers go here.</span><input name="webhook_url" type="url" value="{_e(link.get('webhookUrl'))}"
placeholder="https://pm.example.com/siteline/webhook"></label>
<label class="check wide"><input type="checkbox" name="card_seen" value="1" {'checked' if link.get('sendCardSeen') else ''}>
Also send <span class="mono">card.seen</span> when a person first opens a card</label></div>
<div class="actions"><button class="btn">Save PM link</button></div></form>"""
    key_state = pill("active", "Key set") if link.get("apiKeyHash") else pill("pending", "No key yet")
    pm_status = f"""<div class="body" style="border-top:1px solid var(--border)"><dl class="kv">
<dt>API endpoint</dt><dd class="mono">{_e(config.PUBLIC_URL)}/api/v1</dd>
<dt>API key</dt><dd>{key_state}</dd>
<dt>Last API call</dt><dd>{when(link.get('lastCallAt'), 'Never')}</dd>
<dt>Last error</dt><dd style="color:var(--danger)">{_e(link.get('lastError')) or '<span class="muted">None</span>'}</dd></dl>
<form method="post" action="/platform/companies/{cid}/pm-key" class="actions"
{confirm("Make a new API key and webhook secret? The old key keeps working for 24 hours.")}>
<button class="btn secondary">Make a new API key and webhook secret</button>
<span class="muted small">Shown once. The PM app uses it with docs/CARDS_API.md.</span></form></div>"""
    body = f"""<div class="crumbs"><a href="/platform">Companies</a> / {_e(c['name'])}</div>
<div class="head"><div><h1>{_e(c['name'])} {pill(c['status'])}</h1>
<p class="sub">{_e(c['timeZone'])} · {active_count} active people · PM company {_e(c['pmCompanyId']) or '—'}</p></div>{status_form}</div>
{flash(note)}
{card("People", f'<div class="scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>{people}</tbody></table></div>')}
{card("Pending invites", f'<div class="scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Expires</th></tr></thead><tbody>{pending}</tbody></table></div>')}
{card("Ownership", f"""<div class="body grid2"><form method="post" action="/platform/companies/{cid}/owner-invite">
<div class="fields"><label class="f">New owner's name<input name="name" required></label>
<label class="f">Work email<input name="identifier" type="email" placeholder="name@company.com" required></label></div>
<div class="actions"><button class="btn secondary">Send owner invite</button></div></form>{transfer}</div>""",
          "Invite someone new as owner, or hand ownership to someone already here.")}
{card("PM link", pm_form + pm_status, "How this company's PM app sends cards and gets the answers.", pill(kind, PM_KINDS.get(kind)) if kind else "")}
{_mock_section(company_id) if kind == 'mock' else ''}"""
    return page(c["name"], body, admin, "companies")


def _mock_section(company_id: str) -> str:
    t = db.current()
    previous = t.company_id
    t.set_company(company_id)
    try:
        projects = db.rows("SELECT * FROM pm_mock_projects ORDER BY name")
        tasks = db.rows("SELECT * FROM pm_mock_tasks WHERE deleted_at IS NULL ORDER BY project_id, planned_start, name")
        down = mock.is_down()
    finally:
        t.set_company(previous)
    cid = _e(company_id)
    names = {p["id"]: p["name"] for p in projects}
    project_opts = "".join(f'<option value="{_e(p["id"])}">{_e(p["name"])}</option>' for p in projects)
    statuses = ("not_started", "in_progress", "blocked", "done")

    def status_select(form: str, current: str = "not_started") -> str:
        return (f'<select class="sm" name="status" form="{form}" style="min-width:115px">' + "".join(
            f'<option value="{s}" {"selected" if s == current else ""}>{s.replace("_", " ").capitalize()}</option>' for s in statuses)
                + "</select>")

    # Inputs point at their row's form with form="…": a <form> can't sit inside a <tr>.
    def group(i: int, t: dict) -> str:  # a heading row where a new project's tasks start
        if i and tasks[i - 1]["projectId"] == t["projectId"]:
            return ""
        return f'<tr><td colspan="7" class="strong" style="background:var(--alt)">{_e(names.get(t["projectId"]))}</td></tr>'

    rows = "".join(group(i, t) + f"""<tr>
<td><form id="t{i}" method="post" action="/platform/companies/{cid}/mock/tasks"><input type="hidden" name="id" value="{_e(t['id'])}">
<input type="hidden" name="project_id" value="{_e(t['projectId'])}"></form>
<input class="sm" form="t{i}" name="name" value="{_e(t['name'])}" style="min-width:180px" required></td>
<td><input class="sm" form="t{i}" name="planned_start" type="date" value="{_e(t['plannedStart'])}"></td>
<td><input class="sm" form="t{i}" name="planned_finish" type="date" value="{_e(t['plannedFinish'])}"></td>
<td><input class="sm" form="t{i}" name="owner_ref" type="email" value="{_e(t['ownerRef'])}" placeholder="No owner" style="min-width:150px"></td>
<td>{status_select(f"t{i}", t['status'])}</td>
<td><input class="sm" form="t{i}" name="percent" type="number" min="0" max="100" value="{t['percent']}" style="width:58px"></td>
<td style="white-space:nowrap"><button class="btn small secondary" form="t{i}">Save</button>
<form class="inline" method="post" action="/platform/companies/{cid}/mock/tasks/{_e(t['id'])}/delete" {confirm(f"Remove {t['name']}?")}>
<button class="btn link danger small">Remove</button></form></td></tr>""" for i, t in enumerate(tasks))
    add_form = f"""<form method="post" action="/platform/companies/{cid}/mock/tasks" class="body" style="border-top:1px solid var(--border)">
<input type="hidden" name="id" value=""><input type="hidden" name="status" value="not_started"><input type="hidden" name="percent" value="0">
<div class="fields" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
<label class="f">Project<select name="project_id">{project_opts}</select></label>
<label class="f">New task<input name="name" placeholder="Task name" required></label>
<label class="f">Start<input name="planned_start" type="date" value="{date.today()}"></label>
<label class="f">Finish<input name="planned_finish" type="date" value="{date.today()}"></label>
<label class="f">Owner (email)<input name="owner_ref" type="email" placeholder="name@company.com"></label></div>
<div class="actions"><button class="btn">Add task</button></div></form>""" if projects else ""
    chips = "".join(f"""<span class="chip">{_e(p['name'])} {pill(p['status'])}
<form class="inline" method="post" action="/platform/companies/{cid}/mock/projects/{_e(p['id'])}">
<input type="hidden" name="status" value="{'closed' if p['status'] == 'active' else 'active'}">
<button class="btn link small">{'Close' if p['status'] == 'active' else 'Reopen'}</button></form></span>""" for p in projects)
    down_form = f"""<form method="post" action="/platform/companies/{cid}/mock/down"><input type="hidden" name="down" value="{'0' if down else '1'}">
<button class="btn small {'' if down else 'secondary'}">{'Bring it back' if down else 'Make it stop answering'}</button></form>"""
    warning = '<div class="flash warn" style="margin:16px 20px 0">The mock PM app isn\'t answering. Siteline keeps retrying card answers.</div>'
    body = (warning if down else "") + (f'<div class="chips">{chips}</div>' if chips else "") + f"""<div class="scroll"><table class="dense"><thead><tr><th>Task</th>
<th>Start</th><th>Finish</th><th>Owner (email)</th><th>Status</th><th>%</th><th></th></tr></thead><tbody>
{rows or empty("No tasks yet.", 7)}</tbody></table></div>{add_form}"""
    return card("Mock PM app", body, "Stands in for this company's PM app: its projects and tasks live here, and it only sends cards to people.",
                down_form)


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
    cid = _e(company_id)

    def secret(label: str, value: str, n: int) -> str:
        return f"""<label class="f">{label}<div class="secret"><input id="s{n}" readonly value="{_e(value)}" onclick="this.select()">
<button type="button" class="btn secondary" onclick="navigator.clipboard.writeText(document.getElementById('s{n}').value);this.textContent='Copied'">Copy</button></div></label>"""
    return page("New API key", f"""<div class="crumbs"><a href="/platform">Companies</a> / <a href="/platform/companies/{cid}">Back to company</a></div>
<div class="head"><div><h1>New API key</h1></div></div>
{flash("Copy both now. They aren't shown again. The previous key keeps working for 24 more hours.", "warn")}
<section class="card"><div class="body" style="display:grid;gap:20px">{secret("API key", creds['apiKey'], 1)}{secret("Webhook secret", creds['webhookSecret'], 2)}
<div><a class="btn secondary" href="/platform/companies/{cid}">Done</a></div></div></section>""", admin, "companies")


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
    body = "".join(f"""<tr><td class="muted" style="white-space:nowrap">{when(r['at'])}</td><td class="strong" style="white-space:nowrap">{_e(r['company']) or '—'}</td>
<td style="white-space:nowrap" title="{_e(r['actor'])}">{_e(r['actorName'] or r['actor'])}</td><td><span class="mono">{_e(r['action'])}</span></td>
<td><div class="trunc mono muted" title="{_e(r['target'])}">{_e(r['target'])}</div></td></tr>""" for r in rows) or empty("Nothing yet.", 5)
    return page("Audit log", f"""<div class="head"><div><h1>Audit log</h1><p class="sub">Every platform and admin action, newest first. Latest 300.</p></div></div>
<section class="card"><div class="scroll"><table><thead><tr><th>When</th><th>Company</th><th>Who</th><th>What</th><th>Target</th></tr></thead>
<tbody>{body}</tbody></table></div></section>""", admin, "audit")
