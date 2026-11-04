"""Rate limits, counted in Postgres so they hold across API processes. Exceeding one answers RATE_LIMITED (429); the
app's send queue waits and retries, and the PM app is told when to try again."""
from __future__ import annotations

from .. import db
from ..core import ApiError

# kind: (calls allowed, per window). Per person, generous for real use: a phone flushing a day of queued site photos
# slows down instead of failing, while a script hammering the API is stopped. The Cards API counts per company.
LIMITS = {
    "write": (120, "minute"),   # every change: messages, edits, reactions, settings
    "upload": (30, "minute"),   # photos, voice notes, files (up to 25 MB each)
    "search": (30, "minute"),   # message search scans a channel's whole history
    "invite": (30, "hour"),     # each invite or resend is an email
    "cards_api": (120, "minute"),  # the PM app, per company (docs/CARDS_API.md)
}


def hit(subject: str, kind: str) -> None:
    """Counts one call for `subject` (a person or, for the Cards API, a company); raises RATE_LIMITED once over the
    limit for this window."""
    allowed, window = LIMITS[kind]
    calls = db.value("""INSERT INTO call_counts (subject, kind, window_start, calls) VALUES (%(s)s, %(k)s, date_trunc(%(w)s, now()), 1)
                        ON CONFLICT (subject, kind, window_start) DO UPDATE SET calls = call_counts.calls + 1 RETURNING calls""",
                     s=subject, k=kind, w=window)
    if calls > allowed:
        raise ApiError("RATE_LIMITED", "Too many requests. Wait a moment and try again.",
                       {"retryAfter": 60 if window == "minute" else 3600})
