"""Account state shared by the people routes and the Demo panel: ending sessions, deactivating."""
from __future__ import annotations

from ..core import now_iso
from ..events import hub
from ..store import S


def expire_access_tokens(user_id: str) -> None:
    for t in S().tokens.values():
        if t["userId"] == user_id and t["kind"] == "access":
            t["expired"] = True


def end_sessions(user_id: str) -> None:
    """Signs the person out everywhere: their tokens are removed and live connections closed."""
    s = S()
    for key in [k for k, t in s.tokens.items() if t["userId"] == user_id]:
        del s.tokens[key]
    hub.disconnect_user(user_id)


def deactivate_user(user_id: str) -> None:
    s = S()
    u = s.users.get(user_id)
    if u:
        u["isActive"] = False
        u["updatedAt"] = now_iso()
    end_sessions(user_id)
