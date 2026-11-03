"""Live updates over WebSocket (spec §10.7). Any process (API or worker) publishes inside its transaction:
the event is written to the `events` table and announced with NOTIFY, which Postgres delivers only when
the transaction commits. Each API process listens and sends it to its own sockets, for the named users of
that company only. The app treats every event as "this changed, fetch again"."""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque

from fastapi import WebSocket

from . import config, db

log = logging.getLogger("siteline.events")


class Hub:
    def __init__(self) -> None:
        # user id -> {socket: company id the socket's session is for}
        self.conns: dict[str, dict[WebSocket, str]] = {}
        # Events published by this process, for tests and the dev panel: (user ids, event).
        self.recent: deque[tuple[list[str], dict]] = deque(maxlen=500)

    def add(self, user_id: str, company_id: str, ws: WebSocket) -> None:
        self.conns.setdefault(user_id, {})[ws] = company_id

    def remove(self, user_id: str, ws: WebSocket) -> None:
        self.conns.get(user_id, {}).pop(ws, None)

    def is_online(self, user_id: str, company_id: str | None) -> bool:
        return company_id in self.conns.get(user_id, {}).values()

    async def deliver(self, company_id: str, audience: list[str], event: dict) -> None:
        if event.get("type") == "session.ended":
            for uid in audience:
                for ws, cid in list(self.conns.get(uid, {}).items()):
                    if cid == company_id or event.get("everyCompany"):
                        await _close(ws)
            return
        text = json.dumps(event)
        sockets = [ws for uid in set(audience) for ws, cid in list(self.conns.get(uid, {}).items()) if cid == company_id]
        # All at once, each with a time limit: one phone on a bad line must not hold up everyone else's updates.
        await asyncio.gather(*(_send(ws, text) for ws in sockets))

    def clear(self) -> None:
        self.recent.clear()


SEND_SECONDS = 2


async def _send(ws: WebSocket, text: str) -> None:
    try:
        await asyncio.wait_for(ws.send_text(text), SEND_SECONDS)
    except asyncio.TimeoutError:  # too slow: close it; the app reconnects and fetches everything again
        await _close(ws, TOO_SLOW)
    except Exception:  # a dead socket is cleaned up by its own receive loop
        pass


SIGNED_OUT, TOO_SLOW = 4401, 4008  # the app refreshes its token only on 4401


async def _close(ws: WebSocket, code: int = SIGNED_OUT) -> None:
    try:
        await ws.close(code=code)
    except Exception:
        pass


hub = Hub()


def publish(event: dict, user_ids: list[str]) -> None:
    """Sends `event` to these users of the current company once the current transaction commits."""
    company_id = db.company_id()
    if not company_id:
        raise RuntimeError("publish() needs a company")
    targets = sorted(set(user_ids))
    if config.DEV_TOOLS:  # the dev panel's event log and the tests; production keeps no copy of messages in memory
        hub.recent.append((targets, json.loads(json.dumps(event))))
    event_id = db.value("INSERT INTO events (company_id, audience, event) VALUES (%(c)s, %(a)s, %(e)s) RETURNING id",
                        c=company_id, a=db.Json(targets), e=event)
    db.run("SELECT pg_notify('events', %(id)s)", id=str(event_id))


async def listen(stop: asyncio.Event) -> None:
    """Delivers committed events to this process's sockets until `stop` is set. Reconnects on errors."""
    import psycopg

    while not stop.is_set():
        try:
            async with await psycopg.AsyncConnection.connect(db.DATABASE_URL, autocommit=True) as conn:
                await conn.execute("LISTEN events")
                while not stop.is_set():
                    # Wakes at least once a second to notice `stop`.
                    for n in [n async for n in conn.notifies(timeout=1.0)]:
                        cur = await conn.execute("SELECT company_id, audience, event FROM events WHERE id = %s",
                                                 [int(n.payload)])
                        r = await cur.fetchone()
                        if r:
                            await hub.deliver(r[0], r[1], r[2])
        except Exception:
            if not stop.is_set():
                log.exception("event listener failed; reconnecting")
                await asyncio.sleep(1)
