"""SMS through MSG91 (India; the message templates must be DLT-registered first).
https://docs.msg91.com — Flow API: one template per message kind, variables filled in here."""
from __future__ import annotations

import logging
import os

import httpx

from .. import config

log = logging.getLogger("siteline.sms")

# MSG91 template ids, one per kind of message (set after DLT registration).
TEMPLATES = {"code": "MSG91_TEMPLATE_CODE", "invite": "MSG91_TEMPLATE_INVITE"}


def send(to: str, kind: str, variables: dict) -> None:
    key, template = os.environ.get("MSG91_AUTH_KEY"), os.environ.get(TEMPLATES[kind])
    if not key or not template:
        if config.PRODUCTION:
            raise RuntimeError(f"MSG91_AUTH_KEY or {TEMPLATES[kind]} is not set")
        log.warning("sms (not sent, no key) to=%s kind=%s %r", to, kind, variables)
        return
    r = httpx.post("https://control.msg91.com/api/v5/flow", headers={"authkey": key},
                   json={"template_id": template, "short_url": "0", "recipients": [{"mobiles": to.lstrip("+"), **variables}]},
                   timeout=10)
    r.raise_for_status()
