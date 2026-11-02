"""Background jobs (spec §10.6): rows in `jobs`, run by the worker (app/worker.py).

Jobs are queued in the same transaction as the change that causes them, so a crash never loses one,
and `dedupe_key` stops the same job being queued twice."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .. import db
from ..core import uuid7

# Retries after a failure, then the job is marked failed. pm_write follows the spec (§9.3).
BACKOFF = {
    "pm_write": [60, 300, 900] + [3600] * 21,
    "default": [30, 120, 600],
}
LOCK_SECONDS = 120


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
                        ORDER BY run_at LIMIT %(limit)s FOR UPDATE SKIP LOCKED)
           RETURNING *""", lock=LOCK_SECONDS, limit=limit)


def finish(job: dict) -> None:
    # Codes and other secrets in the payload aren't kept once the job is done.
    db.run("UPDATE jobs SET status = 'done', payload = '{}', locked_until = NULL, updated_at = now() WHERE id = %(id)s",
           id=job["id"])


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


def at(delay_seconds: float) -> datetime:
    return utcnow() + timedelta(seconds=delay_seconds)
