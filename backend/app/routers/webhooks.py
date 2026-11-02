"""Webhooks from a company's PM app (spec §9.3). The body is signed with HMAC-SHA256 over
"<X-Timestamp>.<body>" using that company's webhook secret; the timestamp must be within 5 minutes."""
from __future__ import annotations

import hashlib
import hmac
import json
import time

from fastapi import APIRouter, Header, Request

from .. import db
from ..core import ApiError, invalid
from ..pm.sync import apply_event
from ..services.secrets import decrypt

router = APIRouter(tags=["webhooks"])
WINDOW_SECONDS = 300


def signature(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


@router.post("/webhooks/pm/{company_id}")
async def pm_webhook(company_id: str, request: Request, x_signature: str = Header(""), x_timestamp: str = Header("")):
    body = await request.body()

    def handle() -> dict:
        link = db.row("SELECT webhook_secret FROM pm_links WHERE company_id = %(c)s", c=company_id)
        secret = decrypt(link["webhookSecret"]) if link else None
        try:
            fresh = abs(time.time() - int(x_timestamp)) <= WINDOW_SECONDS
        except ValueError:
            fresh = False
        if not secret or not fresh or not hmac.compare_digest(x_signature, signature(secret, x_timestamp, body)):
            raise ApiError("FORBIDDEN", "Bad signature.")
        try:
            event = json.loads(body)
            event["id"], event["type"]
        except (ValueError, KeyError, TypeError):
            raise invalid({"_": "Expected {id, type, data}"})
        db.current().set_company(company_id)  # only after the signature proved who sent it
        return {"accepted": True, "repeat": not apply_event(event)}

    from fastapi.concurrency import run_in_threadpool

    return await run_in_threadpool(handle)
