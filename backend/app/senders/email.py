"""Email through Resend (https://resend.com/docs/api-reference/emails/send-email)."""
from __future__ import annotations

import logging
import os

import httpx

from .. import config

log = logging.getLogger("siteline.email")
FROM = os.environ.get("EMAIL_FROM", "Siteline <no-reply@siteline.app>")


def send(to: str, subject: str, text: str) -> None:
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        if config.PRODUCTION:
            raise RuntimeError("RESEND_API_KEY is not set")
        log.warning("email (not sent, no key) to=%s subject=%r text=%r", to, subject, text)
        return
    r = httpx.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {key}"},
                   json={"from": FROM, "to": [to], "subject": subject, "text": text}, timeout=10)
    r.raise_for_status()
