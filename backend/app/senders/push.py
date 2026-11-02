"""Push notifications through Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/)."""
from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("siteline.push")
URL = "https://exp.host/--/api/v2/push/send"


def send(tokens: list[str], title: str, body: str, data: dict) -> list[str]:
    """Sends to each device; returns the tokens Expo says are no longer valid (to forget)."""
    if not tokens:
        return []
    if os.environ.get("SITELINE_PUSH", "log") != "expo":
        log.info("push (not sent, SITELINE_PUSH != expo) to=%d title=%r", len(tokens), title)
        return []
    headers = {"Accept": "application/json"}
    if token := os.environ.get("EXPO_ACCESS_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    messages = [{"to": t, "title": title, "body": body, "data": data, "sound": "default"} for t in tokens]
    r = httpx.post(URL, json=messages, headers=headers, timeout=10)
    r.raise_for_status()
    dead = []
    for t, ticket in zip(tokens, r.json().get("data", [])):
        if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
            dead.append(t)
    return dead
