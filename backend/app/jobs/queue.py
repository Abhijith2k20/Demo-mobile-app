"""Background jobs (spec §10.6): rows in `jobs`, run by the worker (app/worker.py).

Jobs are queued in the same transaction as the change that causes them, so a crash never loses one,
and `dedupe_key` stops the same job being queued twice."""
from __future__ import annotations

from datetime import datetime

from .. import db
from ..core import uuid7

# Retries after a failure, then the job is marked failed. Webhooks to the PM app: 1, 5, 15 minutes, then hourly for 24 hours (docs/CARDS_API.md §5).
BACKOFF = {
    "webhook": [60, 300, 900] + [3600] * 23,
    "default": [30, 120, 600],
}
LOCK_SECONDS = 120
# A person is waiting on these: they go before anything else that is due (a slow PM app can't hold up sign-in).
URGENT = ["send_code", "send_invite", "send_push"]


def enqueue(kind: str, payload: dict | None = None, *, run_at: datetime | None = None, company_id: str | None = None,
            dedupe_key: str | None = None) -> bool:
    """Queues a job; False when one with the same dedupe key already exists."""
    created = db.insert("jobs", {
        "id": uuid7(), "companyId": company_id if company_id is not None else db.company_id(), "kind": kind,
        # "Now" is the database's clock, so a job due now is never a few ms in the future for the worker.
        "runAt": run_at.isoformat() if run_at else db.value("SELECT now()"), "payload": payload or {}, "dedupeKey": dedupe_key,
    }, on_conflict_nothing=True)
    return created is not None


def cancel(dedupe_key: str) -> None:
    db.run("UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE dedupe_key = %(k)s AND status = 'pending'",
           k=dedupe_key)


def claim(limit: int = 10) -> list[dict]:
    """Takes due jobs for this worker. A job whose worker died is taken again once its lock runs out."""
    return db.rows(
        """UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = now() + make_interval(secs => %(lock)s),
                  updated_at = now()
           WHERE id IN (SELECT id FROM jobs
                        WHERE run_at <= now() AND (status = 'pending' OR (status = 'running' AND locked_until < now()))
                        ORDER BY kind = ANY(%(urgent)s) DESC, run_at LIMIT %(limit)s FOR UPDATE SKIP LOCKED)
           RETURNING *""", lock=LOCK_SECONDS, limit=limit, urgent=URGENT)


def finish(job: dict) -> None:
    # Codes and other secrets in the payload aren't kept once the job is done. A webhook keeps only what it was about
    # (event and card), for the delivery history.
    db.run("""UPDATE jobs SET status = 'done', locked_until = NULL, updated_at = now(),
                payload = CASE WHEN kind = 'webhook' THEN jsonb_strip_nulls(jsonb_build_object('event', payload->'event',
                                                                                              'cardId', payload->'cardId'))
                               ELSE '{}' END
              WHERE id = %(id)s""", id=job["id"])


def fail(job: dict, error: str, *, retry: bool = True) -> bool:
    """Schedules the next try; returns False once the job has used up its retries."""
    waits = BACKOFF.get(job["kind"], BACKOFF["default"])
    if retry and job["attempts"] <= len(waits):
        db.run("""UPDATE jobs SET status = 'pending', run_at = now() + make_interval(secs => %(wait)s), last_error = %(e)s,
                  locked_until = NULL, updated_at = now() WHERE id = %(id)s""",
               wait=waits[job["attempts"] - 1], e=error[:500], id=job["id"])
        return True
    db.run("UPDATE jobs SET status = 'failed', last_error = %(e)s, locked_until = NULL, updated_at = now() WHERE id = %(id)s",
           e=error[:500], id=job["id"])
    return False
