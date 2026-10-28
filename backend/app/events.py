"""Live updates over WebSocket. Each event goes only to the users the caller names, so the
route that publishes decides who may see it. Clients treat events as "this changed, refetch"."""
from __future__ import annotations

import asyncio
import copy
import json
import logging
from collections import deque
from typing import Callable

from fastapi import WebSocket

log = logging.getLogger("siteline.events")


class Hub:
    def __init__(self) -> None:
        self.conns: dict[str, set[WebSocket]] = {}
        # Recent deliveries, for tests and the Demo panel: (user ids, event).
        self.recent: deque[tuple[list[str], dict]] = deque(maxlen=500)

    def add(self, user_id: str, ws: WebSocket) -> None:
        self.conns.setdefault(user_id, set()).add(ws)

    def remove(self, user_id: str, ws: WebSocket) -> None:
        self.conns.get(user_id, set()).discard(ws)

    def disconnect_user(self, user_id: str) -> None:
        for ws in list(self.conns.get(user_id, ())):
            later(0, lambda ws=ws: asyncio.ensure_future(_close(ws)))
        self.conns.pop(user_id, None)

    def publish(self, event: dict, user_ids: list[str]) -> None:
        targets = sorted(set(user_ids))
        snapshot = copy.deepcopy(event)  # later server-side changes must not leak in
        self.recent.append((targets, snapshot))
        text = json.dumps(snapshot)
        for uid in targets:
            for ws in list(self.conns.get(uid, ())):
                later(0, lambda ws=ws: asyncio.ensure_future(_send(ws, text)))

    def clear(self) -> None:
        self.recent.clear()


async def _send(ws: WebSocket, text: str) -> None:
    try:
        await ws.send_text(text)
    except Exception:  # a dead socket is cleaned up by its own receive loop
        pass


async def _close(ws: WebSocket) -> None:
    try:
        await ws.close(code=4401)
    except Exception:
        pass


hub = Hub()


def publish(event: dict, user_ids: list[str]) -> None:
    hub.publish(event, user_ids)


# ---- Timers (bot reminders, notification batching, scripted teammates) ----

_handles: set[asyncio.TimerHandle] = set()


def later(seconds: float, fn: Callable[[], object]) -> asyncio.TimerHandle | None:
    """Runs `fn` on the event loop after `seconds`. Outside a running loop (some tests) it's skipped."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None

    def run() -> None:
        _handles.discard(handle)
        try:
            fn()
        except Exception:
            log.exception("timer failed")

    handle = loop.call_later(seconds, run)
    _handles.add(handle)
    return handle


def cancel(handle: asyncio.TimerHandle | None) -> None:
    if handle:
        handle.cancel()
        _handles.discard(handle)


def cancel_all() -> None:
    for h in list(_handles):
        h.cancel()
    _handles.clear()
