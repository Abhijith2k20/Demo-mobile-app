"""Fixes from the code audit (2026-11-03): each test fails if its fix is undone."""
from concurrent.futures import ThreadPoolExecutor

from app import db
from app.core import uuid7
from app.jobs import queue
from app.services import integrations
from conftest import channel_named, in_company, project_id


def test_parallel_wrong_codes_all_count_towards_the_limit(client):
    client.post("/auth/otp/request", json={"identifier": "ravi@paliath.in"})
    guess = lambda n: client.post("/auth/otp/verify", json={"identifier": "ravi@paliath.in", "code": f"{n:06d}"})  # noqa: E731
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(guess, range(1, 9)))
    with db.transaction():
        assert db.value("SELECT attempts FROM otp_codes WHERE identifier = 'ravi@paliath.in'") == 8
    r = client.post("/auth/otp/verify", json={"identifier": "ravi@paliath.in", "code": "123456"})
    assert r.json()["error"]["code"] == "OTP_TOO_MANY_ATTEMPTS"  # even the right code is refused now


def test_members_cant_pin_or_fake_edits_through_message_data(login):
    ravi = login("ravi@paliath.in")
    sw = channel_named(ravi, "Villa 99", "site-work")
    m = ravi.post(f"/channels/{sw['id']}/messages",
                  {"id": uuid7(), "type": "text", "body": "hi", "data": {"pinned": True, "edited": True, "x": "y" * 9000}}).json()
    assert m["data"] is None
    assert m["id"] not in {p["id"] for p in ravi.get(f"/channels/{sw['id']}/pins").json()["messages"]}


def test_a_demoted_admin_loses_the_channels_they_only_had_as_admin(login):
    arjun, meera = login("arjun@paliath.in"), login("meera@paliath.in")
    qs = channel_named(meera, "Villa 99", "qs")  # private; Meera reads it as an Admin
    meera.post(f"/channels/{qs['id']}/read", {"upToMessageId": None})
    arjun.patch(f"/users/{meera.user['id']}", {"role": "member"})
    meera = login("meera@paliath.in")
    assert qs["id"] not in {c["id"] for c in meera.get("/channels").json()["channels"]}
    assert meera.get(f"/channels/{qs['id']}").status_code == 404


def test_deactivated_people_get_no_pushes_from_that_company(login):
    arjun, amit, ravi = login("arjun@paliath.in"), login("amit@paliath.in"), login("ravi@paliath.in")
    arjun.post(f"/users/{ravi.user['id']}/deactivate")
    with in_company("Paliath Interiors"):
        db.run("DELETE FROM jobs WHERE kind = 'send_push'")  # only pushes from here on count
    sw = channel_named(amit, "Villa 99", "site-work")
    amit.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "@Ravi hello",
                                                 "data": {"mentions": [ravi.user["id"]]}})
    with in_company("Paliath Interiors"):
        assert not db.value("SELECT 1 FROM jobs WHERE kind = 'send_push' AND payload->>'userId' = %(u)s", u=ravi.user["id"])


def test_dev_routes_need_a_sign_in_and_the_test_code_is_only_for_test_accounts(client):
    assert client.post("/internal/reset").status_code == 401
    assert client.get("/internal/state").status_code == 401
    from app import config

    assert config.fixed_code_for("ravi@paliath.in") == "123456"
    assert config.fixed_code_for("babu@brightline.events") == "123456"
    assert config.fixed_code_for("someone@realcompany.com") is None


def test_urgent_jobs_go_before_slow_webhooks(client):
    with db.transaction():
        db.run("UPDATE jobs SET status = 'done' WHERE status = 'pending'")
        queue.enqueue("webhook", {"event": "x"}, company_id=None)
        queue.enqueue("send_code", {"identifier": "x@y.z", "code": "1"}, company_id=None)
    with db.transaction():
        assert [j["kind"] for j in queue.claim(1)] == ["send_code"]


def test_the_same_card_sent_twice_at_once_comes_back_once(client):
    with in_company("Paliath Interiors"):
        key = {"Authorization": f"Bearer {integrations.new_credentials(db.company_id())['apiKey']}"}
    body = {"id": "same-1", "to": "ravi@paliath.in", "title": "Hello", "scale": [{"id": "a", "label": "A"}]}
    with ThreadPoolExecutor(4) as pool:
        codes = sorted(pool.map(lambda _: client.post("/api/v1/cards", json=body, headers=key).status_code, range(4)))
    assert codes == [200, 200, 200, 201]
    with in_company("Paliath Interiors"):
        assert db.value("SELECT count(*) FROM messages WHERE data->>'cardId' = (SELECT id FROM cards WHERE ext_id = 'same-1')") == 1


def test_guests_added_to_a_project_join_only_the_channels_picked(login):
    arjun, kavya = login("arjun@paliath.in"), login("kavya@paliath.in")
    arjun.patch(f"/users/{kavya.user['id']}", {"role": "guest"})
    oith = project_id(arjun, "OITH")
    design = channel_named(arjun, "OITH", "design")
    arjun.post(f"/projects/{oith}/members", {"userId": kavya.user["id"], "channelIds": [design["id"]]})
    kavya = login("kavya@paliath.in")
    assert {c["name"] for c in kavya.get("/channels").json()["channels"] if c["projectId"] == oith} == {"design"}


def test_a_damaged_platform_cookie_is_just_signed_out(client):
    r = client.get("/platform", cookies={"siteline_platform": "a|not-a-number|x"})
    assert r.status_code == 200 and "Sign in" in r.text


# ---- Second audit (2026-11-03) ----

def test_big_bodies_are_refused_before_anything_reads_them(client):
    huge = {"content-length": str(30 * 1024 * 1024)}
    r = client.post("/uploads", headers=huge, content=b"x")  # not signed in, and the size alone is enough
    assert r.status_code == 413 and r.json()["error"]["code"] == "FILE_TOO_LARGE"
    assert client.post("/auth/otp/request", headers={"content-length": str(2 * 1024 * 1024)}, content=b"x").status_code == 413


def test_code_requests_at_once_still_stop_at_five(client):
    send = lambda _: client.post("/auth/otp/request", json={"identifier": "ravi@paliath.in"}).status_code  # noqa: E731
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(send, range(12)))
    assert codes.count(200) == 5 and codes.count(429) == 7


def test_the_rate_limit_address_is_the_one_the_proxy_added():
    from starlette.requests import Request

    from app.deps import client_ip

    def req(headers):
        return Request({"type": "http", "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
                        "client": ("10.0.0.1", 1)})

    assert client_ip(req({"x-forwarded-for": "1.2.3.4, 203.0.113.9"})) == "203.0.113.9"  # 1.2.3.4 was made up
    assert client_ip(req({})) == "10.0.0.1"


def test_a_slow_phone_does_not_hold_up_the_others():
    import asyncio
    import time

    from app import events

    class Socket:
        def __init__(self, delay):
            self.delay, self.sent, self.closed = delay, [], False

        async def send_text(self, text):
            await asyncio.sleep(self.delay)
            self.sent.append(text)

        async def close(self, code=None):
            self.closed = code

    hub, slow, fast = events.Hub(), Socket(60), Socket(0)
    hub.add("a", "c1", slow)
    hub.add("b", "c1", fast)
    events.SEND_SECONDS, before = 0.2, events.SEND_SECONDS
    try:
        t = time.monotonic()
        asyncio.run(hub.deliver("c1", ["a", "b"], {"type": "message.new"}))
        assert time.monotonic() - t < 1 and fast.sent
        assert slow.closed == events.TOO_SLOW  # not 4401, which would make the app refresh its token
    finally:
        events.SEND_SECONDS = before


def test_signing_in_after_the_invite_was_cancelled_is_explained(login, client):
    from conftest import sent_code

    nisha = login("nisha@brightline.events")
    inv = nisha.post("/invites", {"id": uuid7(), "identifier": "late@crew.example", "name": "Late", "role": "member"}).json()
    client.post("/auth/otp/request", json={"identifier": "late@crew.example"})
    nisha.delete(f"/invites/{inv['invite']['id']}")
    r = client.post("/auth/otp/verify", json={"identifier": "late@crew.example", "code": sent_code("late@crew.example")})
    assert r.json()["error"]["code"] == "INVITE_EXPIRED"


def test_migrations_started_twice_at_once_both_finish():
    with ThreadPoolExecutor(2) as pool:
        assert list(pool.map(lambda _: db.migrate(), range(2))) == [[], []]


# ---- Third audit (2026-11-03) ----

def test_cleanup_books_its_next_run(client):
    from app.worker import ensure_schedules
    from conftest import run_jobs

    ensure_schedules()
    run_jobs({"cleanup"})
    with db.transaction():
        assert db.value("SELECT count(*) FROM jobs WHERE kind = 'cleanup' AND status = 'pending'") == 1


def test_the_mock_stays_quiet_once_the_real_pm_app_is_linked(login):
    from app.mockpm import bot as mock

    ravi = login("ravi@paliath.in")
    before = len(ravi.get("/me/cards").json()["cards"])
    with in_company("Paliath Interiors"):
        db.run("UPDATE integrations SET kind = 'http', webhook_url = 'https://pm.example/hooks' WHERE company_id = current_company()")
        db.run("DELETE FROM jobs WHERE kind LIKE 'mock_%%'")
        mock.plan_day({})
        assert mock.evening_checkins("ravi@paliath.in") == 0
        assert not db.value("SELECT 1 FROM jobs WHERE kind LIKE 'mock_%%'")  # not even tomorrow's plan
    assert len(ravi.get("/me/cards").json()["cards"]) == before


def test_only_companies_on_the_mock_get_its_daily_plan(client):
    from app.worker import ensure_schedules

    with in_company("Brightline Events"):
        db.run("UPDATE integrations SET kind = 'http' WHERE company_id = current_company()")  # a global table
    with db.transaction():
        db.run("DELETE FROM jobs WHERE kind = 'mock_plan_day'")
    ensure_schedules()
    with db.transaction():
        planned = {r["name"] for r in db.rows("""SELECT c.name FROM jobs j JOIN companies c ON c.id = j.company_id
                                                 WHERE j.kind = 'mock_plan_day'""")}
    assert planned == {"Paliath Interiors"}


def test_a_project_without_a_client_can_be_renamed(login):
    meera = login("meera@paliath.in")
    pid = uuid7()
    meera.post("/projects", {"id": pid, "name": "No Client"})
    r = meera.patch(f"/projects/{pid}", {"name": "Still No Client", "client": "", "address": ""})
    assert r.status_code == 200 and r.json()["name"] == "Still No Client"


def test_answers_still_reach_the_pm_app_while_the_company_is_suspended(login, client):
    from app.services import companies
    from conftest import run_jobs

    ravi = login("ravi@paliath.in")
    c = next(x for x in ravi.get("/me/cards").json()["cards"] if x["state"] == "open" and x["content"].get("scale"))
    ravi.post(f"/cards/{c['id']}/answer", {"scale": "50"})
    with db.transaction():
        cid = db.value("SELECT id FROM companies WHERE name = 'Paliath Interiors'")
        companies.set_status(cid, "suspended", "test")
    run_jobs({"webhook"})
    with in_company("Paliath Interiors"):
        assert db.value("SELECT delivery FROM cards WHERE id = %(c)s", c=c["id"]) == "delivered"


def test_reset_from_the_dev_panel_does_not_lock_itself(login):
    arjun = login("arjun@paliath.in")
    assert arjun.post("/internal/reset").json() == {"reset": True}


def test_nul_characters_are_refused_not_a_server_error(login):
    ravi = login("ravi@paliath.in")
    assert ravi.get("/channels/abc%00def").status_code == 422
    sw = channel_named(ravi, "Villa 99", "site-work")
    r = ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "a\u0000b", "data": None})
    assert r.status_code == 422


def test_a_reaction_is_an_emoji_not_text(login):
    ravi = login("ravi@paliath.in")
    sw = channel_named(ravi, "Villa 99", "site-work")
    m = ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "hi", "data": None}).json()
    assert ravi.put(f"/messages/{m['id']}/reactions/{'x' * 300}", {"on": True}).status_code == 422
    assert ravi.put(f"/messages/{m['id']}/reactions/hello", {"on": True}).status_code == 422
    assert ravi.put(f"/messages/{m['id']}/reactions/👍", {"on": True}).json()["reactions"] == {"👍": [ravi.user["id"]]}


def test_one_message_holds_at_most_20_different_reactions(login):
    ravi = login("ravi@paliath.in")
    sw = channel_named(ravi, "Villa 99", "site-work")
    m = ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "hi", "data": None}).json()
    with in_company("Paliath Interiors"):
        db.run("UPDATE messages SET reactions = %(r)s WHERE id = %(id)s",
               r=db.Json({chr(0x1F600 + i): ["x"] for i in range(20)}), id=m["id"])
    assert ravi.put(f"/messages/{m['id']}/reactions/👍", {"on": True}).status_code == 422
    assert ravi.put(f"/messages/{m['id']}/reactions/{chr(0x1F600)}", {"on": True}).status_code == 200  # an existing one


def test_production_refuses_to_start_without_safe_settings(monkeypatch):
    import pytest

    from app import config

    monkeypatch.setattr(config, "PRODUCTION", True)
    monkeypatch.setattr(config, "DEVELOPMENT", False)
    monkeypatch.setattr(config, "FIXED_CODE", "")
    monkeypatch.setattr(config, "SECRET", "s" * 40)
    monkeypatch.setattr(config, "PLATFORM_KEY", "k" * 30)
    monkeypatch.setattr(config, "STORAGE", "local")
    monkeypatch.setattr(config, "PUBLIC_URL", "http://localhost:8000")
    with pytest.raises(RuntimeError, match="SITELINE_STORAGE.*SITELINE_PUBLIC_URL"):
        config.check()
    monkeypatch.setattr(config, "STORAGE", "r2")
    monkeypatch.setattr(config, "PUBLIC_URL", "https://api.siteline.app")
    config.check()  # all good


def test_migrations_build_an_empty_database_from_nothing(monkeypatch):
    """What the first production deploy does. Runs every migration in a fresh, empty schema."""
    import psycopg
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool

    schema = f"fresh_{uuid7().replace('-', '')[:12]}"
    with psycopg.connect(db.DATABASE_URL, autocommit=True) as conn:
        conn.execute(f"CREATE SCHEMA {schema}")
    fresh = ConnectionPool(db.DATABASE_URL, min_size=1, max_size=2, open=True,
                           kwargs={"options": f"-c search_path={schema}", "row_factory": dict_row})
    try:
        monkeypatch.setattr(db, "_pool", fresh)
        applied = db.migrate()
        assert applied and applied[0].startswith("001")
        with fresh.connection() as conn:
            assert conn.execute(f"SELECT count(*) AS n FROM {schema}.schema_migrations").fetchone()["n"] == len(applied)
            assert conn.execute(f"SELECT to_regclass('{schema}.companies') AS t").fetchone()["t"]
        assert db.migrate() == []  # a second start finds everything done
    finally:
        fresh.close()
        with psycopg.connect(db.DATABASE_URL, autocommit=True) as conn:
            conn.execute(f"DROP SCHEMA {schema} CASCADE")


def test_staff_listed_in_the_settings_become_platform_admins(monkeypatch, client):
    from app import config
    from app.main import _add_platform_admins

    monkeypatch.setattr(config, "PLATFORM_ADMINS", ["ops@siteline.app"])
    _add_platform_admins()
    _add_platform_admins()  # every start: no duplicates, no error
    with db.transaction():
        assert db.value("SELECT count(*) FROM platform_admins WHERE email = 'ops@siteline.app'") == 1
