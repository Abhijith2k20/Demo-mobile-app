"""Network conditions + error injection for the Demo panel (§10.5), applied server-side."""
from __future__ import annotations

import asyncio
import random

TIMEOUT_SECONDS = 8.0
_state = {"mode": "online", "inject": None}


def state() -> dict:
    return dict(_state)


def configure(mode: str | None, inject: str | None) -> None:
    if mode:
        _state["mode"] = mode
    if inject is not None:
        _state["inject"] = None if inject == "none" else inject


def take_injection() -> str | None:
    """The pending injection applies to exactly one user write."""
    value, _state["inject"] = _state["inject"], None
    return value


def reset() -> None:
    _state.update(mode="online", inject=None)


async def delay(upload: bool) -> None:
    if _state["mode"] == "slow":
        await asyncio.sleep(random.uniform(3, 5) if upload else random.uniform(2, 4))


def flaky_timeout() -> str | None:
    """'before' = the server never handles it; 'after' = it saves, but the reply is lost."""
    if _state["mode"] != "flaky" or random.random() >= 0.3:
        return None
    return "before" if random.random() < 0.5 else "after"
