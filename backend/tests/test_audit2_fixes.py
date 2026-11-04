"""Fixes from the second ponytail audit: a lost refresh reply, platform code limits, parallel worker loops, uploads
that are safe to repeat and cleaned up when unused, and webhook connections pinned to the checked address."""
import threading

import httpx
import pytest

from app import config, db
from app.core import uuid7
from app.jobs import queue
from app.services import files, integrations
from conftest import in_company, run_jobs

PNG = b"\x89PNG\r\n\x1a\n" + b"1" * 64


def bearer(t):
    return {"Authorization": f"Bearer {t}"}


# ---- 2. A refresh whose reply was lost ----

def test_a_refresh_whose_reply_never_arrived_can_be_retried(client, login):
    api = login("ravi@paliath.in")
    lost = client.post("/auth/refresh", json={"refreshToken": api.refresh}).json()  # the phone never sees this reply
    assert "accessToken" in lost
    again = client.post("/auth/refresh", json={"refreshToken": api.refresh}).json()  # it retries with the token it has
    assert "accessToken" in again and again["accessToken"] != lost["accessToken"]
    assert client.get("/me", headers=bearer(lost["accessToken"])).status_code == 401  # only the newest pair works
    assert client.get("/me", headers=bearer(again["accessToken"])).status_code == 200
    # Now the phone has used its new tokens: the old refresh token can only be a copy, and ends the session.
    assert client.post("/auth/refresh", json={"refreshToken": api.refresh}).json()["error"]["code"] == "AUTH_EXPIRED"
    assert client.get("/me", headers=bearer(again["accessToken"])).status_code == 401


def test_a_stolen_refresh_token_used_after_the_owner_still_ends_the_session(client, login):
    api = login("ravi@paliath.in")
    owner = client.post("/auth/refresh", json={"refreshToken": api.refresh}).json()
    assert client.get("/me", headers=bearer(owner["accessToken"])).status_code == 200
    assert client.post("/auth/refresh", json={"refreshToken": api.refresh}).json()["error"]["code"] == "AUTH_EXPIRED"
    assert client.post("/auth/refresh", json={"refreshToken": owner["refreshToken"]}).json()["error"]["code"] == "AUTH_EXPIRED"


# ---- 3. Platform codes have the same limits as the app ----

def test_platform_codes_are_limited_per_email_whatever_the_ip(client):
    for n in range(5):
        r = client.post("/platform/login", data={"email": "admin@siteline.app"}, headers={"X-Forwarded-For": f"10.7.0.{n}"})
        assert r.status_code == 200 and "Check your email" in r.text
    r = client.post("/platform/login", data={"email": "admin@siteline.app"}, headers={"X-Forwarded-For": "10.7.0.99"},
                    follow_redirects=False)
    assert r.status_code == 303 and "Too+many" in r.headers["location"]


def test_platform_codes_go_to_the_email_and_need_an_admin(client):
    with db.transaction():
        db.run("DELETE FROM jobs WHERE kind = 'send_code'")
    client.post("/platform/login", data={"email": "admin@siteline.app"})
    client.post("/platform/login", data={"email": "nobody@siteline.app"})
    with db.transaction():
        sent = [r["payload"]["identifier"] for r in db.rows("SELECT payload FROM jobs WHERE kind = 'send_code'")]
    assert sent == ["admin@siteline.app"]


# ---- 4. Several worker loops never take the same job ----

def test_parallel_loops_claim_different_jobs(client):
    with db.transaction():
        db.run("DELETE FROM jobs")
        for _ in range(20):
            queue.enqueue("send_push", {"userId": "x", "title": "t", "body": "b"}, company_id=None)
    taken: list[list[str]] = []
    barrier = threading.Barrier(4)

    def claim():
        barrier.wait()
        with db.transaction():
            taken.append([j["id"] for j in queue.claim(5)])

    threads = [threading.Thread(target=claim) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    ids = [i for batch in taken for i in batch]
    assert len(ids) == 20 and len(set(ids)) == 20


# ---- 5. Uploads: safe to repeat, and unused ones are removed ----

def test_sending_the_same_upload_again_returns_the_first(login):
    ravi, meera = login("ravi@paliath.in"), login("meera@paliath.in")
    key = str(uuid7())
    first = ravi.post("/uploads", files={"file": ("a.png", PNG, "image/png")}, data={"kind": "image", "id": key}).json()
    again = ravi.post("/uploads", files={"file": ("a.png", PNG, "image/png")}, data={"kind": "image", "id": key}).json()
    assert first["uploadId"] == again["uploadId"] == key
    with in_company("Paliath Interiors"):
        assert db.value("SELECT count(*) FROM uploads WHERE id = %(id)s", id=key) == 1
    assert meera.post("/uploads", files={"file": ("a.png", PNG, "image/png")}, data={"kind": "image", "id": key}).status_code == 422
    assert ravi.post("/uploads", files={"file": ("a.png", PNG, "image/png")}, data={"kind": "image", "id": "x; DROP"}).status_code == 422


def test_uploads_nobody_used_are_removed_after_a_week(login):
    ravi = login("ravi@paliath.in")
    used = ravi.post("/uploads", files={"file": ("a.png", PNG, "image/png")}, data={"kind": "image", "id": str(uuid7())}).json()["uploadId"]
    unused = ravi.post("/uploads", files={"file": ("b.png", PNG, "image/png")}, data={"kind": "image", "id": str(uuid7())}).json()["uploadId"]
    general = next(c for c in ravi.get("/channels").json()["channels"] if c["kind"] == "company" and c["name"] == "general")
    assert ravi.post(f"/channels/{general['id']}/messages", {"id": uuid7(), "type": "image", "body": None,
                                                             "data": {"attachments": [{"id": "a1", "uploadId": used}]}}).status_code == 200
    with in_company("Paliath Interiors"):
        db.run("UPDATE uploads SET created_at = now() - interval '8 days' WHERE id = ANY(%(ids)s)", ids=[used, unused])
        keys = {r["id"]: r["key"] for r in db.rows("SELECT id, key FROM uploads WHERE id = ANY(%(ids)s)", ids=[used, unused])}
    assert files.local_path(keys[unused]).exists()
    with db.transaction():
        db.run("UPDATE jobs SET status = 'done' WHERE kind = 'cleanup'")
        queue.enqueue("cleanup", {}, company_id=None, dedupe_key=f"cleanup:test:{uuid7()}")
    run_jobs({"cleanup"})
    with in_company("Paliath Interiors"):
        left = {r["id"] for r in db.rows("SELECT id FROM uploads WHERE id = ANY(%(ids)s)", ids=[used, unused])}
    assert left == {used}
    assert not files.local_path(keys[unused]).exists() and files.local_path(keys[used]).exists()


# ---- 6. Webhooks connect to the address that was checked ----

def test_webhooks_connect_to_the_checked_address_with_the_real_name_for_tls(login, monkeypatch):
    monkeypatch.setattr(config, "DEVELOPMENT", False)
    answers = iter([[(2, 1, 6, "", ("93.184.216.34", 443))], [(2, 1, 6, "", ("10.0.0.5", 443))]])
    monkeypatch.setattr(integrations.socket, "getaddrinfo", lambda *a, **k: next(answers))
    sent = []
    monkeypatch.setattr(integrations.httpx, "post", lambda url, **kw: sent.append((url, kw)) or httpx.Response(200, json={}))
    with in_company("Paliath Interiors"):
        db.run("UPDATE integrations SET kind = 'http', webhook_url = 'https://pm.example.com:8443/hook' WHERE company_id = current_company()")
        integrations._post(integrations.current(), "card.answered", {}, "evt_pin_1")
        url, kw = sent[0]
        assert url == "https://93.184.216.34:8443/hook"
        assert kw["headers"]["Host"] == "pm.example.com:8443" and kw["extensions"] == {"sni_hostname": "pm.example.com"}
        # The name now points inside: refused before any connection.
        with pytest.raises(integrations.Unreachable):
            integrations._post(integrations.current(), "card.answered", {}, "evt_pin_2")
    assert len(sent) == 1


# ---- 8. Activity items have no task ids ----

def test_activity_items_carry_no_task_ids(login):
    arjun, ravi = login("arjun@paliath.in"), login("ravi@paliath.in")
    general = next(c for c in arjun.get("/channels").json()["channels"] if c["kind"] == "company" and c["name"] == "general")
    arjun.post(f"/channels/{general['id']}/messages", {"id": uuid7(), "type": "text", "body": "@Ravi hello",
                                                       "data": {"mentions": [ravi.user["id"]]}})
    items = ravi.get("/activity").json()["items"]
    assert items and all("taskIds" not in a for a in items)
