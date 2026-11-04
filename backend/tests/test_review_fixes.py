"""Fixes from the design review: webhook URL safety, webhook secret overlap, delivery history with resend,
per-conversation mute, and company separation on the shared (non-RLS) tables."""
import httpx
import pytest

from app import config, db
from app.core import ApiError, uuid7
from app.services import integrations
from conftest import in_company, run_jobs


def _open_card(api) -> dict:
    return next(c for c in api.get("/me/cards").json()["cards"] if c["state"] == "open" and c["content"].get("scale"))


def _send(api, channel_id, body):
    assert api.post(f"/channels/{channel_id}/messages", {"id": uuid7(), "type": "text", "body": body, "data": None}).status_code == 200


def _pushes_to(user_id: str) -> int:
    with db.transaction():
        return db.value("SELECT count(*) FROM jobs WHERE kind = 'send_push' AND payload->>'userId' = %(u)s", u=user_id)


# ---- Webhook URL (SSRF) ----

def test_webhook_urls_must_be_public_https_outside_development(monkeypatch):
    monkeypatch.setattr(config, "DEVELOPMENT", False)
    for bad in ("http://8.8.8.8/hook", "https://127.0.0.1/hook", "https://10.1.2.3/hook", "https://192.168.1.2/hook",
                "https://169.254.169.254/latest/meta-data", "https://[::1]/hook", "https://user:pw@8.8.8.8/hook", "ftp://8.8.8.8/x",
                "not a url"):
        with pytest.raises(ApiError):
            integrations.check_webhook_url(bad)
    integrations.check_webhook_url("https://8.8.8.8/siteline/webhook")  # a public address is fine
    integrations.check_webhook_url(None)
    monkeypatch.setattr(config, "DEVELOPMENT", True)
    integrations.check_webhook_url("http://localhost:8099/hook")  # a developer's own test receiver


def test_a_private_webhook_url_is_refused_when_saved_and_never_called(login, client, monkeypatch):
    calls = []
    monkeypatch.setattr(integrations.httpx, "post", lambda *a, **k: calls.append(a) or httpx.Response(200))
    with in_company("Paliath Interiors"):
        cid = db.company_id()
    client.post("/platform/login", data={"email": "admin@siteline.app"})
    client.post("/platform/verify", data={"email": "admin@siteline.app", "code": "123456"})
    monkeypatch.setattr(config, "DEVELOPMENT", False)
    r = client.post(f"/platform/companies/{cid}/pm-link", data={"kind": "http", "webhook_url": "https://127.0.0.1/hook"},
                    follow_redirects=False)
    assert "Not+saved" in r.headers["location"]
    # Saved earlier (or the name now points inside): delivery refuses it too, and keeps retrying instead of calling it.
    with in_company("Paliath Interiors"):
        db.run("UPDATE integrations SET kind = 'http', webhook_url = 'https://127.0.0.1/hook' WHERE company_id = current_company()")
    ravi = login("ravi@paliath.in")
    ravi.post(f"/cards/{_open_card(ravi)['id']}/answer", {"scale": "50"})
    run_jobs({"webhook"})
    assert calls == []
    with in_company("Paliath Interiors"):
        assert db.value("SELECT last_error FROM integrations WHERE company_id = current_company()") == "The webhook URL isn't allowed"


# ---- Webhook secret overlap ----

def test_after_a_new_secret_webhooks_carry_both_signatures_for_a_day(login, client, monkeypatch):
    with in_company("Paliath Interiors"):
        db.run("UPDATE integrations SET kind = 'http', webhook_url = 'https://pm.example/hooks' WHERE company_id = current_company()")
        old = integrations.new_credentials(db.company_id())["webhookSecret"]
        new = integrations.new_credentials(db.company_id())["webhookSecret"]
    sent = []
    monkeypatch.setattr(integrations.httpx, "post", lambda url, content, headers, timeout: sent.append((content, headers)) or httpx.Response(200, json={}))
    ravi = login("ravi@paliath.in")
    ravi.post(f"/cards/{_open_card(ravi)['id']}/answer", {"scale": "75"})
    run_jobs({"webhook"})
    raw, h = sent[0]
    ts = h["X-Siteline-Timestamp"]
    assert h["X-Siteline-Signature"] == integrations.signature(new, ts, raw)
    assert h["X-Siteline-Signature-Previous"] == integrations.signature(old, ts, raw)
    # After the 24 hours, only the new one.
    with in_company("Paliath Interiors"):
        db.run("UPDATE integrations SET previous_secret_until = now() - interval '1 minute' WHERE company_id = current_company()")
        integrations._post(integrations.current(), "card.answered", {}, "evt_after_a_day")
    assert "X-Siteline-Signature-Previous" not in sent[-1][1]


# ---- Delivery history and resend ----

def test_failed_webhooks_are_listed_and_can_be_sent_again(login, client, monkeypatch):
    with in_company("Paliath Interiors"):
        db.run("UPDATE integrations SET kind = 'http', webhook_url = 'https://pm.example/hooks' WHERE company_id = current_company()")
    monkeypatch.setattr(integrations.httpx, "post", lambda *a, **k: httpx.Response(500))
    ravi, arjun, nisha = login("ravi@paliath.in"), login("arjun@paliath.in"), login("nisha@brightline.events")
    card = _open_card(ravi)
    ravi.post(f"/cards/{card['id']}/answer", {"scale": "50"})
    for _ in range(30):
        run_jobs({"webhook"}, due_in_seconds=4000)
    status = arjun.get("/integration").json()
    failed = next(d for d in status["deliveries"] if d["status"] == "failed")
    assert failed["canRetry"] and failed["attempts"] >= 20 and "500" in failed["error"] and failed["cardTitle"] == card["content"]["title"]
    assert status["stats"]["failed"] >= 1
    # Only Owners and Admins, and only their own company.
    assert ravi.post(f"/integration/deliveries/{failed['id']}/retry").status_code == 403
    assert nisha.post(f"/integration/deliveries/{failed['id']}/retry").status_code == 404
    assert all(d["id"] != failed["id"] for d in nisha.get("/integration").json().get("deliveries", []))
    # Sent again as the same event; this time the PM app takes it.
    monkeypatch.setattr(integrations.httpx, "post", lambda *a, **k: httpx.Response(200, json={}))
    assert arjun.post(f"/integration/deliveries/{failed['id']}/retry").status_code == 200
    assert next(c for c in ravi.get("/me/cards").json()["cards"] if c["id"] == card["id"])["delivery"] == "pending"
    run_jobs({"webhook"})
    assert next(c for c in ravi.get("/me/cards").json()["cards"] if c["id"] == card["id"])["delivery"] == "delivered"
    done = next(d for d in arjun.get("/integration").json()["deliveries"] if d["id"] == failed["id"])
    assert (done["status"], done["event"], done["cardTitle"]) == ("done", "card.answered", card["content"]["title"])  # still says what it was
    assert arjun.post(f"/integration/deliveries/{failed['id']}/retry").status_code == 404  # nothing left to retry


# ---- Mute ----

def test_a_muted_conversation_sends_no_pushes_except_mentions(login):
    ravi, meera = login("ravi@paliath.in"), login("meera@paliath.in")
    dm = ravi.post("/dms", {"userId": meera.user["id"]}).json()["channel"]
    _send(ravi, dm["id"], "first")
    assert meera.put(f"/channels/{dm['id']}/mute", {"muted": True}).json()["channel"]["muted"] is True
    before = _pushes_to(meera.user["id"])
    _send(ravi, dm["id"], "you won't hear this")
    assert _pushes_to(meera.user["id"]) == before
    general = next(c for c in meera.get("/channels").json()["channels"] if c["kind"] == "company" and c["name"] == "general")
    meera.put(f"/channels/{general['id']}/mute", {"muted": True})
    # A mention still reaches her (the app sends who was mentioned with the message).
    assert ravi.post(f"/channels/{general['id']}/messages", {"id": uuid7(), "type": "text", "body": "@Meera please check",
                                                             "data": {"mentions": [meera.user["id"]]}}).status_code == 200
    assert _pushes_to(meera.user["id"]) == before + 1
    assert next(c for c in meera.get("/channels").json()["channels"] if c["id"] == general["id"])["muted"] is True
    assert next(c for c in ravi.get("/channels").json()["channels"] if c["id"] == general["id"])["muted"] is False  # hers only
    meera.put(f"/channels/{dm['id']}/mute", {"muted": False})
    _send(ravi, dm["id"], "now you will")
    assert _pushes_to(meera.user["id"]) == before + 2


def test_mute_stays_inside_the_company(login):
    ravi, nisha = login("ravi@paliath.in"), login("nisha@brightline.events")
    theirs = next(c for c in nisha.get("/channels").json()["channels"] if c["kind"] == "company")
    assert ravi.put(f"/channels/{theirs['id']}/mute", {"muted": True}).status_code == 404


# ---- Shared tables across companies ----

def test_shared_tables_never_cross_companies(login):
    """invites, integrations, jobs, memberships and activities have no row-level security, so each query filters by
    company by hand. Every route on them is checked from the other company."""
    arjun, nisha = login("arjun@paliath.in"), login("nisha@brightline.events")
    theirs = nisha.post("/invites", {"id": uuid7(), "identifier": "only.brightline@crew.example", "name": "Only Brightline",
                                     "role": "member"}).json()["invite"]
    assert all(i["identifier"] != "only.brightline@crew.example" for i in arjun.get("/invites").json()["invites"])
    assert arjun.post(f"/invites/{theirs['id']}/resend").status_code == 404
    assert arjun.delete(f"/invites/{theirs['id']}").status_code == 404
    paliath_people = {u["email"] for u in arjun.get("/users").json()["users"]}
    assert "nisha@brightline.events" not in paliath_people and "farhan@brightline.events" not in paliath_people
    with in_company("Brightline Events"):
        db.run("UPDATE integrations SET kind = 'http', webhook_url = 'https://pm.example/hooks' WHERE company_id = current_company()")
        job = db.insert("jobs", {"id": uuid7(), "companyId": db.company_id(), "kind": "webhook", "runAt": db.value("SELECT now()"),
                                 "payload": {"event": "person.joined", "body": {}}, "status": "failed", "dedupeKey": uuid7()})
    assert all(d["id"] != job["id"] for d in arjun.get("/integration").json()["deliveries"])
    assert arjun.post(f"/integration/deliveries/{job['id']}/retry").status_code == 404
    assert any(d["id"] == job["id"] for d in nisha.get("/integration").json()["deliveries"])
    nisha_items = {a["id"] for a in nisha.get("/activity").json()["items"]}
    assert not nisha_items & {a["id"] for a in arjun.get("/activity").json()["items"]}


def test_the_platform_panel_lists_deliveries_and_sends_a_failed_one_again(client):
    with in_company("Paliath Interiors"):
        cid = db.company_id()
        job = db.insert("jobs", {"id": uuid7(), "companyId": cid, "kind": "webhook", "runAt": db.value("SELECT now()"),
                                 "payload": {"event": "person.left", "body": {}}, "status": "failed", "attempts": 26,
                                 "lastError": "Retry: The PM app answered 503", "dedupeKey": uuid7()})
    client.post("/platform/login", data={"email": "admin@siteline.app"})
    client.post("/platform/verify", data={"email": "admin@siteline.app", "code": "123456"})
    page = client.get(f"/platform/companies/{cid}").text
    assert "Webhook deliveries" in page and "person.left" in page and "The PM app answered 503" in page and "Send again" in page
    r = client.post(f"/platform/companies/{cid}/deliveries/{job['id']}/retry", follow_redirects=False)
    assert "sent+again" in r.headers["location"]
    with in_company("Paliath Interiors"):
        assert db.value("SELECT status FROM jobs WHERE id = %(id)s", id=job["id"]) == "pending"
        assert db.value("SELECT count(*) FROM audit_log WHERE action = 'webhook.retried' AND target = %(id)s", id=job["id"]) == 1


def test_deleting_or_leaving_another_companys_things_is_not_found(login):
    """Found by the live sweep: these said 200 ("already gone") for another company's ids. Nothing changed, but every
    other route says 404, so these do too."""
    arjun, nisha = login("arjun@paliath.in"), login("nisha@brightline.events")
    theirs = next(c for c in nisha.get("/channels").json()["channels"] if c["kind"] == "project" and c["name"] != "general")
    project = nisha.get("/projects").json()["projects"][0]
    invite = nisha.post("/invites", {"id": uuid7(), "identifier": "decline.me@crew.example", "name": "Decline Me", "role": "member"}).json()["invite"]
    assert arjun.delete(f"/channels/{theirs['id']}").status_code == 404
    assert arjun.post(f"/channels/{theirs['id']}/leave").status_code == 404
    assert arjun.delete(f"/projects/{project['id']}").status_code == 404
    assert arjun.post(f"/auth/invites/{invite['id']}/decline").status_code == 404
    assert nisha.get(f"/channels/{theirs['id']}").status_code == 200 and nisha.get(f"/projects/{project['id']}").status_code == 200
