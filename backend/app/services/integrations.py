"""The company's PM app link (spec §9.3): its API key, its webhook URL, delivering answers and other events to
it, and the channel messages it posts. A company has one integration: the mock PM app or a real one (`http`)."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time

import httpx

from .. import config, db
from ..core import ApiError, invalid
from ..jobs.queue import enqueue
from ..notify import add_activity, push
from ..store import BOT_ID, admins, project_channel, project_managers, setup
from . import files
from .cards import person_for_ref, project_for_ref, set_delivery
from .messaging import post_message
from .secrets import decrypt, encrypt

WEBHOOK_TIMEOUT = httpx.Timeout(10.0, connect=3.0)


class Unreachable(Exception):
    """The PM app didn't take the webhook; try again later."""


def _hash(key: str) -> str:
    return hmac.new(config.SECRET.encode(), ("api-key:" + key).encode(), hashlib.sha256).hexdigest()


def current() -> dict | None:
    return db.row("SELECT * FROM integrations WHERE company_id = current_company()")


# ---- Keys ----

def new_credentials(company_id: str) -> dict:
    """A new API key (the previous one keeps working for 24 hours) and webhook secret. Shown once."""
    key, secret = f"sk_{secrets.token_urlsafe(32)}", f"whsec_{secrets.token_urlsafe(24)}"
    db.run("""UPDATE integrations SET previous_key_hash = api_key_hash,
                previous_key_until = CASE WHEN api_key_hash IS NULL THEN NULL ELSE now() + interval '24 hours' END,
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
    who = db.row("SELECT email, phone FROM users WHERE id = %(u)s", u=user_id)
    return who["email"] or who["phone"]


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
    raw = json.dumps(body).encode()
    ts = str(int(time.time()))
    headers = {"Content-Type": "application/json", "X-Siteline-Event": event, "X-Siteline-Id": event_id,
               "X-Siteline-Timestamp": ts,
               "X-Siteline-Signature": signature(decrypt(integration["webhookSecret"]) or "", ts, raw)}
    try:
        r = httpx.post(integration["webhookUrl"], content=raw, headers=headers, timeout=WEBHOOK_TIMEOUT)
    except httpx.HTTPError as e:
        _failed(str(e))
        raise Unreachable(str(e)) from e
    if r.status_code >= 300:
        _failed(f"The PM app answered {r.status_code}")
        raise Unreachable(f"The PM app answered {r.status_code}")
    try:
        return r.json() if r.content else {}
    except ValueError:
        return {}


def _failed(error: str) -> None:
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
        add_activity(userId=uid, kind="notice", actorId=card["userId"], projectId=card["projectId"], channelId=None,
                     messageId=None, taskIds=[], text=f"An answer to \"{card['content']['title']}\" couldn't reach the PM app.",
                     lines=[])


# ---- Messages the PM app posts in project channels ----

def post_channel_message(*, ext_id: str, project_ref: str, channel: str | None, card: dict,
                         notify: dict | None = None) -> dict:
    """A status or escalation card in a project channel, with Activity and pushes when asked. The same id again
    is the same message."""
    if existing := db.row("SELECT * FROM messages WHERE data->>'extId' = %(e)s AND type = 'card'", e=ext_id):
        return existing
    project = project_for_ref(project_ref)
    ch = project_channel(project["id"], channel or setup()["workChannel"])
    if not ch:
        raise invalid({"channel": "No such channel in this project"})
    for upload_id in card.get("photos") or []:
        if not db.value("SELECT 1 FROM uploads WHERE id = %(id)s", id=upload_id):
            raise invalid({"photos": "Upload not found"})
    data = {"extId": ext_id, "content": card}
    m = post_message(ch, BOT_ID, type="card", body=None, data=data)
    notify = notify or {}
    people = set(project_managers(project["id"]) if notify.get("managers") else [])
    people |= {person_for_ref(ref)["id"] for ref in notify.get("people") or []}
    for uid in people:
        add_activity(userId=uid, kind="notice", actorId=BOT_ID, projectId=project["id"], channelId=ch["id"],
                     messageId=m["id"], taskIds=[], text=card["title"], lines=list(card.get("lines") or [])[:2])
    if people and notify.get("push"):
        push(sorted(people), project["name"], notify["push"], {"url": f"/channel/{ch['id']}"}, kind="notice")
    return m


def unmatched() -> list[str]:
    """People the PM app named who aren't on Siteline yet (from every project it sent)."""
    i = current()
    found = (i or {}).get("options", {}).get("unmatchedByProject") or {}
    return sorted({ref for refs in found.values() for ref in refs})


def remember_unmatched(project_ref: str, refs: list[str]) -> None:
    db.run("""UPDATE integrations SET options = jsonb_set(options, '{unmatchedByProject}',
                coalesce(options->'unmatchedByProject', '{}') || jsonb_build_object(%(p)s::text, %(r)s::jsonb))
              WHERE company_id = current_company()""", p=project_ref, r=json.dumps(refs))
