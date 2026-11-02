"""Creating and running companies (spec §9.2). Only the Siteline team does this: from the platform panel, or
the PM app through POST /platform/companies once it can."""
from __future__ import annotations

import copy
import re

from .. import config, db
from ..core import ApiError, invalid, uuid7
from ..jobs.queue import enqueue
from ..setups import TEMPLATES
from . import accounts
from .secrets import encrypt


def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "company"
    slug, n = base, 1
    while db.value("SELECT 1 FROM companies WHERE slug = %(s)s", s=slug):
        n += 1
        slug = f"{base}-{n}"
    return slug


def create(*, name: str, time_zone: str, template: str, owner_name: str, owner_identifier: str, actor: str,
           pm_kind: str = "mock", pm_company_id: str | None = None, pm_base_url: str | None = None,
           pm_api_key: str | None = None, pm_webhook_secret: str | None = None, company_id: str | None = None) -> dict:
    """The company with its setup, both company channels, the owner's invite and the PM link. The invite is
    sent and a first PM sync runs as jobs once this commits."""
    identifier = accounts.normalize_identifier(owner_identifier)
    if template not in TEMPLATES:
        raise invalid({"template": "Pick a template"})
    if pm_kind == "http" and not (pm_base_url and pm_api_key):
        raise invalid({"pmBaseUrl": "The PM app's address and API key are needed"})
    cid = company_id or uuid7()
    c = db.insert("companies", {"id": cid, "name": name, "slug": _slug(name), "timeZone": time_zone,
                                "setup": copy.deepcopy(TEMPLATES[template]), "pmCompanyId": pm_company_id})
    t = db.current()
    previous = t.company_id
    t.set_company(cid)
    try:
        db.insert("channels", {"id": uuid7(), "companyId": cid, "projectId": None, "name": "announcements", "kind": "company",
                               "isPrivate": False, "postingPolicy": "admins"})
        db.insert("channels", {"id": uuid7(), "companyId": cid, "projectId": None, "name": "general", "kind": "company",
                               "isPrivate": False, "postingPolicy": "everyone"})
    finally:
        t.set_company(previous)
    if pm_kind != "none":  # without a link the company makes its own projects in Siteline
        db.insert("pm_links", {"companyId": cid, "kind": pm_kind, "baseUrl": pm_base_url, "apiKey": encrypt(pm_api_key),
                               "webhookSecret": encrypt(pm_webhook_secret), "options": {}})
        enqueue("pm_sync", {}, company_id=cid, dedupe_key=f"pm_sync:first:{cid}")
    invite_owner(cid, owner_name, identifier, actor)
    accounts.audit(cid, actor, "company.created", cid, {"name": name, "template": template, "pmKind": pm_kind})
    enqueue("plan_day", {}, company_id=cid, dedupe_key=f"plan_day:first:{cid}")
    return c


def invite_owner(company_id: str, name: str, identifier: str, actor: str) -> dict:
    """(Re)sends the owner's invite; signing in with that email or phone makes them the Owner."""
    db.run("UPDATE invites SET status = 'cancelled' WHERE company_id = %(c)s AND role = 'owner' AND status = 'pending'",
           c=company_id)
    invite = db.insert("invites", {"id": uuid7(), "companyId": company_id, "identifier": identifier, "name": name,
                                   "role": "owner", "channelIds": [], "invitedBy": None,
                                   "expiresAt": db.value(f"SELECT now() + interval '{config.INVITE_TTL_DAYS} days'")})
    company = db.value("SELECT name FROM companies WHERE id = %(c)s", c=company_id)
    enqueue("send_invite", {"identifier": identifier, "inviter": "The Siteline team", "company": company,
                            "link": config.APP_LINK}, company_id=company_id)
    accounts.audit(company_id, actor, "owner.invited", identifier)
    return invite


def set_status(company_id: str, status: str, actor: str) -> None:
    """Suspend: nobody can open it, sessions end, the bot and sync stop. Active again restores it."""
    if status not in ("active", "suspended"):
        raise invalid({"status": "Pick active or suspended"})
    db.run("UPDATE companies SET status = %(s)s, updated_at = now() WHERE id = %(c)s", s=status, c=company_id)
    if status == "suspended":
        db.run("UPDATE sessions SET revoked_at = now() WHERE company_id = %(c)s AND revoked_at IS NULL", c=company_id)
        db.run("UPDATE jobs SET status = 'cancelled' WHERE company_id = %(c)s AND status = 'pending'", c=company_id)
    else:
        enqueue("plan_day", {}, company_id=company_id)
    accounts.audit(company_id, actor, f"company.{status}", company_id)


def transfer_ownership(company_id: str, new_owner_id: str, actor: str) -> None:
    """Keeps exactly one Owner: the old one becomes an Admin."""
    m = accounts.membership(new_owner_id, company_id)
    if not m or m["status"] != "active":
        raise ApiError("NOT_A_MEMBER", "That person isn't in this company.")
    db.run("UPDATE memberships SET role = 'admin', updated_at = now() WHERE company_id = %(c)s AND role = 'owner'", c=company_id)
    db.run("UPDATE memberships SET role = 'owner', updated_at = now() WHERE company_id = %(c)s AND user_id = %(u)s",
           c=company_id, u=new_owner_id)
    accounts.audit(company_id, actor, "owner.transferred", new_owner_id)


def update_setup(company_id: str, setup: dict, actor: str) -> None:
    for key in ("projectChannels", "workChannel", "jobTitles", "defaultJobTitle", "problemTypes"):
        if key not in setup:
            raise invalid({"setup": f"The setup needs {key}"})
    names = {c["name"] for c in setup["projectChannels"]}
    if "general" not in names or setup["workChannel"] not in names:
        raise invalid({"setup": "projectChannels needs general and the workChannel"})
    if setup["defaultJobTitle"] not in {jt["name"] for jt in setup["jobTitles"]}:
        raise invalid({"setup": "defaultJobTitle must be one of jobTitles"})
    db.run("UPDATE companies SET setup = %(s)s, updated_at = now() WHERE id = %(c)s", s=setup, c=company_id)
    accounts.audit(company_id, actor, "setup.changed", company_id)


def update_pm_link(company_id: str, *, kind: str, base_url: str | None, api_key: str | None, webhook_secret: str | None,
                   pm_company_id: str | None, actor: str) -> None:
    changes = {"kind": kind, "baseUrl": base_url}
    if api_key:
        changes["apiKey"] = encrypt(api_key)
    if webhook_secret:
        changes["webhookSecret"] = encrypt(webhook_secret)
    db.update("pm_links", {"companyId": company_id}, changes)
    db.run("UPDATE companies SET pm_company_id = %(p)s WHERE id = %(c)s", p=pm_company_id, c=company_id)
    enqueue("pm_sync", {}, company_id=company_id)
    accounts.audit(company_id, actor, "pm_link.changed", company_id, {"kind": kind})
