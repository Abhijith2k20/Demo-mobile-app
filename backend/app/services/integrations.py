"""The company's PM app link (spec §9.3): its API key, its webhook URL, and delivering answers and other events to it. A company has one integration: the mock PM app or a real one (`http`)."""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import secrets
import socket
import time
from urllib.parse import urlparse

import httpx

from .. import config, db
from ..core import ApiError, invalid, not_found
from ..jobs.queue import enqueue
from ..notify import add_activity
from ..store import admins
from . import accounts, files
from .cards import set_delivery
from .secrets import decrypt, encrypt

WEBHOOK_TIMEOUT = httpx.Timeout(10.0, connect=3.0)


class Unreachable(Exception):
    """The PM app didn't take the webhook; try again later."""


def check_webhook_url(url: str | None) -> None:
    """Refuses a webhook URL that could point Siteline at its own network (SSRF): outside local development it must be
    https and every address its name resolves to must be public. Checked when saved and again before each delivery."""
    if not url:
        return
    u = urlparse(url)
    if u.scheme not in ("https", "http") or not u.hostname or u.username or u.password:
        raise invalid({"webhookUrl": "Enter a full https:// address"})
    if config.DEVELOPMENT:
        return
    if u.scheme != "https":
        raise invalid({"webhookUrl": "Use an https:// address"})
    try:
        addrs = {ai[4][0] for ai in socket.getaddrinfo(u.hostname, u.port or 443, proto=socket.IPPROTO_TCP)}
    except OSError:
        raise invalid({"webhookUrl": "This address can't be found"}) from None
    if not addrs or not all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs):
        raise invalid({"webhookUrl": "Use a public internet address, not a private or local one"})


def _hash(key: str) -> str:
    return hmac.new(config.SECRET.encode(), ("api-key:" + key).encode(), hashlib.sha256).hexdigest()


def current() -> dict | None:
    return db.row("SELECT * FROM integrations WHERE company_id = current_company()")


# ---- Keys ----

def new_credentials(company_id: str) -> dict:
    """A new API key and webhook secret, shown once. For 24 hours the previous key still works and webhooks are also
    signed with the previous secret (X-Siteline-Signature-Previous), so the PM app can switch over without failures."""
    key, secret = f"sk_{secrets.token_urlsafe(32)}", f"whsec_{secrets.token_urlsafe(24)}"
    db.run("""UPDATE integrations SET previous_key_hash = api_key_hash,
                previous_key_until = CASE WHEN api_key_hash IS NULL THEN NULL ELSE now() + interval '24 hours' END,
                previous_webhook_secret = webhook_secret,
                previous_secret_until = CASE WHEN webhook_secret IS NULL THEN NULL ELSE now() + interval '24 hours' END,
                api_key_hash = %(h)s, webhook_secret = %(s)s WHERE company_id = %(c)s""",
           h=_hash(key), s=encrypt(secret), c=company_id)
    return {"apiKey": key, "webhookSecret": secret}


def company_for_key(key: str) -> str:
    """The company an API key belongs to; refused if unknown, rotated out, or the company is suspended."""
    h = _hash(key or "")
    row = db.row("""SELECT i.company_id, c.status FROM integrations i JOIN companies c ON c.id = i.company_id
                    WHERE i.api_key_hash = %(h)s OR (i.previous_key_hash = %(h)s AND i.previous_key_until > now())""", h=h)
    if not row:
        raise ApiError("AUTH_EXPIRED", "Unknown API key.")
    if row["status"] != "active":
        raise ApiError("COMPANY_SUSPENDED", "This company isn't available on Siteline right now.")
    db.run("UPDATE integrations SET last_call_at = now() WHERE company_id = %(c)s", c=row["companyId"])
    return row["companyId"]


# ---- Webhooks to the PM app ----

def signature(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def send_event(event: str, body: dict, event_id: str) -> None:
    """Queues a webhook (only when the company has a PM app linked)."""
    if current():
        enqueue("webhook", {"event": event, "body": body, "eventId": event_id}, dedupe_key=f"webhook:{event_id}")


def _person_ref(user_id: str) -> str:
    return db.value("SELECT email FROM users WHERE id = %(u)s", u=user_id)


def send_card_seen(card: dict) -> None:
    i = current()
    if i and i["sendCardSeen"]:
        send_event("card.seen", {"card": card["extId"], "ref": card["ref"], "person": _person_ref(card["userId"]),
                                 "seenAt": card["seenAt"]}, f"evt_card.seen_{card['id']}")


def count_call(company_id: str, limit: int) -> bool:
    """Counts one Cards API call for this minute; False once the company is over `limit`."""
    calls = db.value("""INSERT INTO api_calls (company_id, minute, calls) VALUES (%(c)s, date_trunc('minute', now()), 1)
                        ON CONFLICT (company_id, minute) DO UPDATE SET calls = api_calls.calls + 1 RETURNING calls""",
                     c=company_id)
    return calls <= limit


def _answer_body(card: dict) -> dict:
    """card.answered, with links to the person's files (valid 7 days) and upload ids."""
    a = card["answer"] or {}
    company = db.company_id()
    choice = {"scale": a["scale"]} if a.get("scale") else {k: a[k] for k in ("button", "choice") if a.get(k)}
    note: dict = {}
    if a.get("note"):
        note["text"] = a["note"]
    if a.get("voiceUploadId"):
        note["voice"] = {"url": files.signed_url(company, a["voiceUploadId"], days=7), "upload": a["voiceUploadId"],
                         "seconds": a.get("voiceSec")}
    if a.get("photoUploadIds"):
        note["photos"] = [{"url": files.signed_url(company, u, days=7), "upload": u} for u in a["photoUploadIds"]]
    return {"card": card["extId"], "ref": card["ref"], "person": _person_ref(card["userId"]), "answer": choice,
            "note": note, "answeredAt": card["answeredAt"], "receivedAt": card["receivedAt"]}


def deliver(payload: dict) -> None:
    """The `webhook` job. Raises Unreachable to retry; a reply decides how the card shows the answer."""
    integration = current()
    card = db.row("SELECT * FROM cards WHERE id = %(id)s", id=payload["cardId"]) if payload.get("cardId") else None
    if not integration:
        if card:
            set_delivery(card["id"], "failed", "No PM app is linked")
        return
    event = payload["event"]
    body = _answer_body(card) if card else payload["body"]
    event_id = payload.get("eventId") or f"evt_{event}_{card['id']}"
    if integration["kind"] == "mock":
        from ..mockpm import receive  # the stand-in PM app takes webhooks in this process

        try:
            reply = receive(event, body)
        except Exception as e:  # the mock being "down" (or failing) is retried like a real PM app
            raise Unreachable(str(e)) from e
    else:
        reply = _post(integration, event, body, event_id)
    if card:
        if (reply or {}).get("result") == "refused":
            set_delivery(card["id"], "refused", (reply or {}).get("message") or "The PM app didn't accept this answer")
        else:
            set_delivery(card["id"], "delivered")
    db.run("UPDATE integrations SET last_error = NULL WHERE company_id = current_company()")


def _post(integration: dict, event: str, body: dict, event_id: str) -> dict:
    if not integration["webhookUrl"]:
        raise Unreachable("No webhook URL set")
    try:
        check_webhook_url(integration["webhookUrl"])  # again now: the name may resolve somewhere else than when saved
    except ApiError as e:
        raise Unreachable("The webhook URL isn't allowed") from e
    raw = json.dumps(body).encode()
    ts = str(int(time.time()))
    headers = {"Content-Type": "application/json", "X-Siteline-Event": event, "X-Siteline-Id": event_id,
               "X-Siteline-Timestamp": ts,
               "X-Siteline-Signature": signature(decrypt(integration["webhookSecret"]) or "", ts, raw)}
    previous = integration.get("previousWebhookSecret")
    if previous and integration.get("previousSecretUntil") and db.value("SELECT %(t)s::timestamptz > now()", t=integration["previousSecretUntil"]):
        headers["X-Siteline-Signature-Previous"] = signature(decrypt(previous) or "", ts, raw)
    try:
        r = httpx.post(integration["webhookUrl"], content=raw, headers=headers, timeout=WEBHOOK_TIMEOUT)
    except httpx.HTTPError as e:
        raise Unreachable(f"Couldn't reach the PM app: {e}") from e
    if r.status_code >= 300:
        raise Unreachable(f"The PM app answered {r.status_code}")
    try:
        return r.json() if r.content else {}
    except ValueError:
        return {}


def record_failure(error: str) -> None:
    """Called by the worker after a failed webhook attempt, in its own transaction."""
    db.run("UPDATE integrations SET last_error = %(e)s WHERE company_id = current_company()", e=error[:300])


def gave_up(payload: dict) -> None:
    """After 24 hours of retries: the card says so and the company's admins are told."""
    if not payload.get("cardId"):
        return
    card = db.row("SELECT * FROM cards WHERE id = %(id)s", id=payload["cardId"])
    if not card:
        return
    set_delivery(card["id"], "failed", "Couldn't reach the PM app")
    for uid in admins():
        add_activity(userId=uid, kind="notice", actorId=card["userId"], projectId=None, channelId=None,
                     messageId=None, taskIds=[], text=f"An answer to \"{card['content']['title']}\" couldn't reach the PM app.",
                     lines=[])


# ---- Delivery history (platform panel and the app's PM link screen) ----

def deliveries(limit: int = 30) -> list[dict]:
    """This company's recent webhooks to the PM app, newest first: what was sent, how it went, how many tries."""
    rows = db.rows("""SELECT j.id, j.status, j.attempts, j.run_at, j.last_error, j.created_at, j.updated_at,
                             j.payload->>'event' AS event, c.content->>'title' AS card_title, c.delivery, c.delivery_error
                      FROM jobs j LEFT JOIN cards c ON c.id = j.payload->>'cardId'
                      WHERE j.company_id = current_company() AND j.kind = 'webhook'
                      ORDER BY j.created_at DESC LIMIT %(n)s""", n=limit)
    return [{"id": r["id"], "event": r["event"], "cardTitle": r["cardTitle"], "status": r["status"], "attempts": r["attempts"],
             "nextTryAt": r["runAt"] if r["status"] == "pending" and r["attempts"] else None,
             "error": (r["lastError"] or "").removeprefix("Retry: ") or (r["deliveryError"] if r["delivery"] == "refused" else None),
             "refused": r["delivery"] == "refused", "createdAt": r["createdAt"], "updatedAt": r["updatedAt"],
             "canRetry": r["status"] == "failed"} for r in rows]


def delivery_stats() -> dict:
    """Counts for the last 7 days, for a quick health check."""
    return db.row("""SELECT
        (SELECT count(*) FROM cards WHERE created_at > now() - interval '7 days') AS cards_sent,
        (SELECT count(*) FROM cards WHERE answered_at > now() - interval '7 days') AS cards_answered,
        (SELECT count(*) FROM jobs WHERE company_id = current_company() AND kind = 'webhook' AND status IN ('pending', 'running')) AS pending,
        (SELECT count(*) FROM jobs WHERE company_id = current_company() AND kind = 'webhook' AND status = 'failed') AS failed""")


def retry_delivery(job_id: str, actor: str) -> None:
    """Sends a webhook that gave up again, as the same event (same X-Siteline-Id), so the PM app can still drop repeats.
    Only this company's failed webhooks; anything else is "not found"."""
    job = db.row("""UPDATE jobs SET status = 'pending', attempts = 0, run_at = now(), locked_until = NULL, last_error = NULL,
                      updated_at = now()
                    WHERE id = %(id)s AND company_id = current_company() AND kind = 'webhook' AND status = 'failed'
                    RETURNING payload""", id=job_id)
    if not job:
        raise not_found("Delivery")
    if job["payload"].get("cardId"):
        set_delivery(job["payload"]["cardId"], "pending")
    accounts.audit(db.company_id(), actor, "webhook.retried", job_id)
