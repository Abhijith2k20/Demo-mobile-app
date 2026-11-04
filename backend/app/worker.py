"""The worker (spec §10.6): runs due jobs. Start it with `python -m app.worker`; in development the API can
run one in a thread instead (SITELINE_WORKER=inline). More than one worker can run: jobs are claimed with
SKIP LOCKED, so each is taken once."""
from __future__ import annotations

import logging
import threading
import time

from . import db
from .jobs import queue
from .jobs.handlers import COMPANY_JOBS, HANDLERS, Retry, on_failed, on_gave_up

log = logging.getLogger("siteline.worker")


def run_job(job: dict) -> None:
    try:
        with db.transaction(job["companyId"]):
            active = job["companyId"] is None or db.value(
                "SELECT status = 'active' FROM companies WHERE id = %(c)s", c=job["companyId"])
            if active or job["kind"] not in COMPANY_JOBS:
                HANDLERS[job["kind"]](job["payload"])
            queue.finish(job)
    except Exception as e:
        if not isinstance(e, Retry):
            log.exception("job %s (%s) failed", job["id"], job["kind"])
        with db.transaction(job["companyId"]):
            on_failed(job, str(e))  # its own transaction: the failed attempt's changes were rolled back
            if not queue.fail(job, f"{type(e).__name__}: {e}", retry=job["kind"] in HANDLERS):
                on_gave_up(job)


def run_due(limit: int = 1) -> int:
    """Runs the jobs that are due now; returns how many ran. One at a time by default, so each pick is the most
    urgent due job (a batch of slow webhooks would otherwise hold up a sign-in code that arrives meanwhile)."""
    with db.transaction():
        jobs = queue.claim(limit)
        db.run("""INSERT INTO worker_heartbeat (id, seen_at) VALUES (1, now())
                  ON CONFLICT (id) DO UPDATE SET seen_at = now()""")
    for job in jobs:
        run_job(job)
    return len(jobs)


SCHEDULE_CHECK_SECONDS = 3600


def ensure_schedules() -> None:
    """Companies on the mock PM app have its daily plan queued, and cleanup runs hourly."""
    with db.transaction():
        companies = [r["id"] for r in db.rows("SELECT id FROM companies WHERE status = 'active'")]
        queue.enqueue("cleanup", {}, company_id=None, dedupe_key=f"cleanup:{time.strftime('%Y-%m-%dT%H', time.gmtime())}")
    for cid in companies:
        with db.transaction(cid):
            # `integrations` is a global table (no row-level security): filter by company by hand.
            mock = db.value("SELECT 1 FROM integrations WHERE company_id = %(c)s AND kind = 'mock'", c=cid)
            if mock and not db.value("""SELECT count(*) FROM jobs WHERE company_id = %(c)s AND kind = 'mock_plan_day'
                                        AND status IN ('pending', 'running')""", c=cid):
                queue.enqueue("mock_plan_day", {}, company_id=cid)


def loop(stop: threading.Event | None = None) -> None:
    checked = 0.0
    while not (stop and stop.is_set()):
        try:
            # Hourly, not only at start: a daily plan or clean-up that failed for good is booked again.
            if time.monotonic() - checked > SCHEDULE_CHECK_SECONDS:
                ensure_schedules()
                checked = time.monotonic()
            if run_due() == 0:
                time.sleep(1)
        except Exception:
            log.exception("worker loop failed")
            time.sleep(5)


def start_inline() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=loop, args=(stop,), daemon=True, name="siteline-worker").start()
    return stop


if __name__ == "__main__":
    from .logs import setup_logging

    setup_logging()
    db.migrate()
    log.info("worker started")
    loop()
