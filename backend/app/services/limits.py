"""Per-person rate limits. Exceeding one answers RATE_LIMITED (429), which the app's send queue waits out and retries."""
from __future__ import annotations

from .. import db
from ..core import ApiError

# kind: (calls allowed, per window). Generous for real use: a phone flushing a day of queued site photos slows down
# instead of failing; a script hammering the API is stopped.
LIMITS = {
    "write": (120, "minute"),   # every change: messages, edits, reactions, settings
    "upload": (30, "minute"),   # photos, voice notes, files (up to 25 MB each)
    "search": (30, "minute"),   # message search scans a channel's whole history
    "invite": (30, "hour"),     # each invite or resend is an email
}


def hit(user_id: str, kind: str) -> None:
    """Counts one call; raises RATE_LIMITED once the person is over the limit for this window."""
    allowed, window = LIMITS[kind]
    calls = db.value("""INSERT INTO user_calls (user_id, kind, window_start, calls) VALUES (%(u)s, %(k)s, date_trunc(%(w)s, now()), 1)
                        ON CONFLICT (user_id, kind, window_start) DO UPDATE SET calls = user_calls.calls + 1 RETURNING calls""",
                     u=user_id, k=kind, w=window)
    if calls > allowed:
        raise ApiError("RATE_LIMITED", "Too many requests. Wait a moment and try again.",
                       {"retryAfter": 60 if window == "minute" else 3600})
