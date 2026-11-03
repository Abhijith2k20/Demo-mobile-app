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
    assert config.fixed_code_for("+919800000005") == "123456"
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
