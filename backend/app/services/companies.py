"""Creating and running companies (spec §9.2). Only the Siteline team does this: from the platform panel, or
the PM app through POST /platform/companies once it can."""
from __future__ import annotations

import re

from .. import config, db
from ..core import ApiError, invalid, uuid7
from ..jobs.queue import enqueue
from . import accounts
from .integrations import check_webhook_url


def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "company"
    slug, n = base, 1
    while db.value("SELECT 1 FROM companies WHERE slug = %(s)s", s=slug):
        n += 1
        slug = f"{base}-{n}"
    return slug


def create(*, name: str, time_zone: str, owner_name: str, owner_identifier: str, actor: str,
           pm_kind: str = "mock", pm_company_id: str | None = None, webhook_url: str | None = None,
           company_id: str | None = None) -> dict:
    """The company with both company channels, the owner's invite and the PM link. The PM app's API
    key is made on the platform panel (shown once)."""
    check_webhook_url(webhook_url)
    identifier = accounts.normalize_identifier(owner_identifier)
    cid = company_id or uuid7()
    c = db.insert("companies", {"id": cid, "name": name, "slug": _slug(name), "timeZone": time_zone,
                                "pmCompanyId": pm_company_id})
    with db.as_company(cid):
        db.insert("channels", {"id": uuid7(), "companyId": cid, "projectId": None, "name": "announcements", "kind": "company",
                               "isPrivate": False, "postingPolicy": "admins"})
        db.insert("channels", {"id": uuid7(), "companyId": cid, "projectId": None, "name": "general", "kind": "company",
                               "isPrivate": False, "postingPolicy": "everyone"})
    if pm_kind != "none":  # without a link the company simply gets no cards
        db.insert("integrations", {"companyId": cid, "kind": pm_kind, "webhookUrl": webhook_url, "options": {}})
        if pm_kind == "mock":
            enqueue("mock_plan_day", {}, company_id=cid, dedupe_key=f"mock_plan_day:first:{cid}")
    invite_owner(cid, owner_name, identifier, actor)
    accounts.audit(cid, actor, "company.created", cid, {"name": name, "pmKind": pm_kind})
    return c


def invite_owner(company_id: str, name: str, identifier: str, actor: str) -> dict:
    """(Re)sends the owner's invite; signing in with that email makes them the Owner."""
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
    """Suspend: nobody can open it, sessions end, the mock PM app's timers stop. Active again restores it."""
    if status not in ("active", "suspended"):
        raise invalid({"status": "Pick active or suspended"})
    db.run("UPDATE companies SET status = %(s)s, updated_at = now() WHERE id = %(c)s", s=status, c=company_id)
    if status == "suspended":
        db.run("UPDATE sessions SET revoked_at = now() WHERE company_id = %(c)s AND revoked_at IS NULL", c=company_id)
        # Answers already given still go to the PM app; everything else for this company stops.
        db.run("""UPDATE jobs SET status = 'cancelled' WHERE company_id = %(c)s AND status = 'pending'
                  AND kind <> 'webhook'""", c=company_id)
    elif db.value("SELECT 1 FROM integrations WHERE company_id = %(c)s AND kind = 'mock'", c=company_id):
        enqueue("mock_plan_day", {}, company_id=company_id)
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


def update_pm_link(company_id: str, *, kind: str, webhook_url: str | None, pm_company_id: str | None, actor: str,
                   card_seen: bool = False) -> None:
    if kind not in ("mock", "http"):
        raise invalid({"kind": "Pick mock or http"})
    check_webhook_url(webhook_url)
    db.run("""INSERT INTO integrations (company_id, kind, webhook_url, send_card_seen, options)
              VALUES (%(c)s, %(k)s, %(u)s, %(s)s, '{}')
              ON CONFLICT (company_id) DO UPDATE SET kind = excluded.kind, webhook_url = excluded.webhook_url,
                send_card_seen = excluded.send_card_seen""", c=company_id, k=kind, u=webhook_url, s=card_seen)
    db.run("UPDATE companies SET pm_company_id = %(p)s WHERE id = %(c)s", p=pm_company_id, c=company_id)
    if kind == "mock":  # back on the mock: its daily plan starts again (it stops itself while on a real PM app)
        enqueue("mock_plan_day", {}, company_id=company_id)
    accounts.audit(company_id, actor, "pm_link.changed", company_id, {"kind": kind})
