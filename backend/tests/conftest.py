import os

# Tests use their own database and run jobs by hand (no worker thread, no scripted teammates).
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql://siteline:siteline@localhost:5433/siteline_test")
os.environ["SITELINE_ENV"] = "development"
os.environ["SITELINE_WORKER"] = "off"
os.environ["SITELINE_SEED"] = "0"

import io

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import db
from app.events import hub
from app.main import app

_snapshot: dict[str, bytes] = {}


def _tables(conn) -> list[str]:
    # Live events are short-lived and their ids come from a counter that TRUNCATE restarts: not copied.
    return [t for t in db.PER_COMPANY_TABLES + db.GLOBAL_TABLES if t != "events"]


def restore_seed() -> None:
    """The seed, restored from a copy taken once per test run (seeding itself takes about a second)."""
    from app.seed import reset_everything

    with psycopg.connect(db.DATABASE_URL, autocommit=True) as conn:
        if not _snapshot:
            reset_everything()
            with conn.transaction():
                for t in db.PER_COMPANY_TABLES:  # the owner sees every company's rows while copying
                    conn.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
                for t in _tables(conn):
                    buf = io.BytesIO()
                    with conn.cursor().copy(f"COPY {t} TO STDOUT") as cp:
                        for chunk in cp:
                            buf.write(chunk)
                    _snapshot[t] = buf.getvalue()
                for t in db.PER_COMPANY_TABLES:
                    conn.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        else:
            # The table owner skips row-level security while copying the seed back in.
            with conn.transaction():
                for t in db.PER_COMPANY_TABLES:
                    conn.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
                conn.execute("TRUNCATE " + ", ".join(_tables(conn) + ["events"]) + " RESTART IDENTITY CASCADE")
                for t in reversed(_tables(conn)):
                    with conn.cursor().copy(f"COPY {t} FROM STDIN") as cp:
                        cp.write(_snapshot[t])
                for t in db.PER_COMPANY_TABLES:
                    conn.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
    hub.clear()
    from app import netsim

    netsim.reset()


class Api:
    """A signed-in client: api.get('/me'), api.post(...). Raises nothing; check .status_code."""

    def __init__(self, client: TestClient, identifier: str, company: str | None = None):
        assert client.post("/auth/otp/request", json={"identifier": identifier}).status_code == 200
        r = client.post("/auth/otp/verify", json={"identifier": identifier, "code": "123456"})
        assert r.status_code == 200, r.text
        body = r.json()
        self.client = client
        self.companies = body["companies"]
        session = body.get("session")
        if company or not session:
            pick = next(c for c in body["companies"] if company is None or c["name"] == company)
            r = client.post("/auth/session", json={"companyId": pick["id"]},
                            headers={"Authorization": f"Bearer {body['accessToken']}"})
            assert r.status_code == 200, r.text
            session = r.json()
        self.user = session["user"]
        self.company = session["company"]
        self.token = session["accessToken"]
        self.refresh = session["refreshToken"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def get(self, path, **kw):
        return self.client.get(path, headers={**self.headers, **kw.pop("headers", {})}, **kw)

    def post(self, path, json=None, **kw):
        return self.client.post(path, json=json, headers=self.headers, **kw)

    def patch(self, path, json=None):
        return self.client.patch(path, json=json, headers=self.headers)

    def put(self, path, json=None):
        return self.client.put(path, json=json, headers=self.headers)

    def delete(self, path):
        return self.client.delete(path, headers=self.headers)


@pytest.fixture(scope="session")
def _app():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def client(_app):
    restore_seed()
    _app.cookies.clear()  # the client is shared: no test starts signed in to the platform panel
    return _app


@pytest.fixture()
def login(client):
    return lambda identifier, company=None: Api(client, identifier, company)


def run_jobs(kinds: set[str] | None = None, *, due_in_seconds: float = 0) -> int:
    """Runs queued jobs now (optionally only some kinds, or also ones due within `due_in_seconds`)."""
    from app.worker import run_job

    with db.transaction():
        db.run("""UPDATE jobs SET run_at = now() WHERE status = 'pending'
                  AND run_at <= now() + make_interval(secs => %(s)s) AND (%(k)s::text[] IS NULL OR kind = ANY(%(k)s))""",
               s=due_in_seconds, k=list(kinds) if kinds else None)
        jobs = db.rows("""UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE status = 'pending'
                          AND run_at <= now() AND (%(k)s::text[] IS NULL OR kind = ANY(%(k)s)) RETURNING *""",
                       k=list(kinds) if kinds else None)
    for job in sorted(jobs, key=lambda j: j["runAt"]):
        run_job(job)
    return len(jobs)


def sent_code(identifier: str) -> str:
    """The code last queued for this address (what the person gets by SMS or email); "" when none was sent."""
    with db.transaction():
        return db.value("""SELECT payload->>'code' FROM jobs WHERE kind = 'send_code' AND payload->>'identifier' = %(v)s
                           ORDER BY created_at DESC LIMIT 1""", v=identifier) or ""


def events_for(user_id: str, kind: str | None = None) -> list[dict]:
    return [e for targets, e in hub.recent if user_id in targets and (kind is None or e["type"] == kind)]


def project_id(api: Api, name: str) -> str:
    return next(p["id"] for p in api.get("/projects").json()["projects"] if p["name"].startswith(name))


def channel_named(api: Api, project: str | None, name: str) -> dict:
    pid = project_id(api, project) if project else None
    return next(c for c in api.get("/channels").json()["channels"] if c["name"] == name and c["projectId"] == pid)


def in_company(name: str):
    """A transaction for a seeded company by name (for checks straight in the database)."""
    with db.transaction():
        cid = db.value("SELECT id FROM companies WHERE name = %(n)s", n=name)
    return db.transaction(cid)
