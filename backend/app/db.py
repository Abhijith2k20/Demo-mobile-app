"""Postgres access (spec §10.4). Every request or job runs in one transaction; the session's company is set
on it, so row-level security limits per-company tables to that company. Records come back as camelCase
dicts, the same shape the API returns, with times as ISO strings.

    with transaction(company_id):        # jobs, scripts; requests get one from main.py
        rows("SELECT * FROM channels WHERE kind = %(k)s", k="company")
        insert("messages", {...})
"""
from __future__ import annotations

import contextvars
import os
import re
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://siteline:siteline@localhost:5433/siteline")
MIGRATIONS = Path(__file__).resolve().parents[1] / "db" / "migrations"

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        import atexit

        atexit.register(close_pool)
        _pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=int(os.environ.get("DB_POOL_SIZE", "10")),
                               kwargs={"row_factory": dict_row}, open=True)
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


# ---- Transactions ----

class Tx:
    """One transaction. The connection is taken from the pool on first use, so a request that never
    touches the database never holds one."""

    def __init__(self, company_id: str | None = None):
        self.company_id = company_id
        self._ctx = None
        self.conn = None

    def connection(self):
        if self.conn is None:
            self._ctx = pool().connection()
            self.conn = self._ctx.__enter__()
            self._apply_company()
        return self.conn

    def set_company(self, company_id: str | None) -> None:
        self.company_id = company_id
        if self.conn is not None:
            self._apply_company()

    def _apply_company(self) -> None:
        self.conn.execute("SELECT set_config('app.company_id', %s, true)", [self.company_id or ""])

    def finish(self, error: BaseException | None = None) -> None:
        """Commits, or rolls back when `error` is given, and returns the connection to the pool."""
        if self._ctx is not None:
            from psycopg.pq import TransactionStatus

            if error is None and self.conn.info.transaction_status == TransactionStatus.INERROR:
                error = RuntimeError("transaction failed")
            ctx, self._ctx, self.conn = self._ctx, None, None
            ctx.__exit__(type(error) if error else None, error, None)


_tx: contextvars.ContextVar[Tx | None] = contextvars.ContextVar("siteline_tx", default=None)


def current() -> Tx:
    t = _tx.get()
    if t is None:
        raise RuntimeError("No database transaction: wrap the call in db.transaction()")
    return t


def begin(company_id: str | None = None) -> tuple[Tx, contextvars.Token]:
    t = Tx(company_id)
    return t, _tx.set(t)


def end(t: Tx, token: contextvars.Token, error: BaseException | None = None) -> None:
    try:
        t.finish(error)
    finally:
        _tx.reset(token)


def forget(token: contextvars.Token) -> None:
    """Drops the transaction from this context (when it was finished in a thread)."""
    _tx.reset(token)


@contextmanager
def transaction(company_id: str | None = None) -> Iterator[Tx]:
    t, token = begin(company_id)
    try:
        yield t
    except BaseException as e:
        end(t, token, e)
        raise
    end(t, token)


def company_id() -> str | None:
    return current().company_id


@contextmanager
def as_company(company: str | None) -> Iterator[None]:
    """Runs the block in this company (row-level security follows), then switches back to the one before.
    For work that reaches into a company from outside it: the platform panel, sign-in, jobs for every company."""
    t = current()
    previous = t.company_id
    t.set_company(company)
    try:
        yield
    finally:
        t.set_company(previous)


# ---- Queries ----

_SNAKE = re.compile(r"_([a-z0-9])")
_CAMEL = re.compile(r"(?<!^)([A-Z])")


def camel(name: str) -> str:
    return _SNAKE.sub(lambda m: m.group(1).upper(), name)


def snake(name: str) -> str:
    return _CAMEL.sub(r"_\1", name).lower()


def iso(value: datetime) -> str:
    """The API's time format: UTC with milliseconds, e.g. 2026-11-02T06:14:35.842Z."""
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


def _out(value: Any) -> Any:
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def _record(row: dict) -> dict:
    return {camel(k): _out(v) for k, v in row.items()}


Json = Jsonb  # wrap a list meant for a jsonb column in a plain query: db.Json([...])


def _params(params: dict) -> dict:
    """In queries, dicts are JSON and lists are Postgres arrays (for ANY(...))."""
    return {k: Jsonb(v) if isinstance(v, dict) else v for k, v in params.items()}


def _column_values(record: dict) -> dict:
    """In inserts and updates every dict or list goes into a jsonb column."""
    return {k: Jsonb(v) if isinstance(v, (dict, list)) else v for k, v in record.items()}


def execute(query: str | sql.Composable, params: dict | None = None):
    return current().connection().execute(query, _params(params or {}))


def rows(query: str | sql.Composable, **params) -> list[dict]:
    return [_record(r) for r in execute(query, params).fetchall()]


def row(query: str | sql.Composable, **params) -> dict | None:
    r = execute(query, params).fetchone()
    return _record(r) if r else None


def value(query: str | sql.Composable, **params) -> Any:
    r = execute(query, params).fetchone()
    return _out(next(iter(r.values()))) if r else None


def run(query: str | sql.Composable, **params) -> int:
    return execute(query, params).rowcount


def insert(table: str, record: dict, *, on_conflict_nothing: bool = False) -> dict | None:
    """Inserts a camelCase record and returns it as stored (None if it already existed and was skipped)."""
    cols = [snake(k) for k in record]
    q = sql.SQL("INSERT INTO {} ({}) VALUES ({}){} RETURNING *").format(
        sql.Identifier(table),
        sql.SQL(", ").join(map(sql.Identifier, cols)),
        sql.SQL(", ").join(sql.Placeholder(k) for k in record),
        sql.SQL(" ON CONFLICT DO NOTHING") if on_conflict_nothing else sql.SQL(""),
    )
    r = execute(q, _column_values(record)).fetchone()
    return _record(r) if r else None


def insert_many(table: str, records: list[dict]) -> None:
    if not records:
        return
    keys = list(records[0])
    q = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(snake(k)) for k in keys),
        sql.SQL(", ").join(sql.Placeholder(k) for k in keys),
    )
    with current().connection().cursor() as cur:
        cur.executemany(q, [_column_values(r) for r in records])


def update(table: str, where: dict, changes: dict) -> dict | None:
    """UPDATE table SET changes WHERE where; returns the updated record."""
    if not changes:
        return row(sql.SQL("SELECT * FROM {} WHERE {}").format(sql.Identifier(table), _where(where)),
                   **{f"w_{k}": v for k, v in where.items()})
    q = sql.SQL("UPDATE {} SET {} WHERE {} RETURNING *").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.SQL("{} = {}").format(sql.Identifier(snake(k)), sql.Placeholder(f"s_{k}")) for k in changes),
        _where(where),
    )
    params = {**{f"s_{k}": v for k, v in _column_values(changes).items()}, **{f"w_{k}": v for k, v in where.items()}}
    r = execute(q, params).fetchone()
    return _record(r) if r else None


def delete(table: str, where: dict) -> int:
    q = sql.SQL("DELETE FROM {} WHERE {}").format(sql.Identifier(table), _where(where))
    return execute(q, {f"w_{k}": v for k, v in where.items()}).rowcount


def _where(where: dict) -> sql.Composable:
    return sql.SQL(" AND ").join(sql.SQL("{} = {}").format(sql.Identifier(snake(k)), sql.Placeholder(f"w_{k}"))
                                 for k in where)


# ---- Migrations ----

MIGRATION_LOCK = 7321


def migrate() -> list[str]:
    """Applies db/migrations/*.sql not applied yet, in name order, each in its own transaction."""
    applied: list[str] = []
    with pool().connection() as conn:
        # The API and the worker start together on a deploy: one migrates, the other waits, then finds it done.
        conn.execute("SELECT pg_advisory_lock(%s)", [MIGRATION_LOCK])
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz DEFAULT now())")
            conn.commit()
            done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations").fetchall()}
            conn.commit()  # end the read's transaction, so each migration below commits on its own
            for path in sorted(MIGRATIONS.glob("*.sql")):
                if path.name in done:
                    continue
                with conn.transaction():
                    conn.execute(path.read_text())
                    conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", [path.name])
                applied.append(path.name)
        finally:
            conn.rollback()
            conn.execute("SELECT pg_advisory_unlock(%s)", [MIGRATION_LOCK])  # the connection goes back to the pool
            conn.commit()
    return applied


PER_COMPANY_TABLES = [
    "pm_mock_cards", "pm_mock_writes", "pm_mock_tasks", "pm_mock_projects", "uploads",
    "activities", "cards", "messages", "channel_members", "channels", "project_members", "projects",
]
GLOBAL_TABLES = [
    "call_counts", "events", "jobs", "audit_log", "platform_admins", "push_tokens", "sessions", "otp_requests", "otp_codes",
    "invites", "memberships", "integrations", "companies", "users", "worker_heartbeat",
]


def wipe() -> None:
    """Development and tests only: empties every table."""
    with pool().connection() as conn:
        conn.execute("TRUNCATE " + ", ".join(PER_COMPANY_TABLES + GLOBAL_TABLES) + " RESTART IDENTITY CASCADE")
