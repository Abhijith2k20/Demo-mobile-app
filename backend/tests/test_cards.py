"""Cards (spec 2.1, docs/CARDS_API.md): the Cards API, answers going back to the PM app as webhooks, and the
mock PM app that uses the same functions a real one reaches over HTTP."""
import json

import httpx

from app import db
from app.core import uuid7
from app.mockpm import bot as mock
from app.services import integrations
from conftest import channel_named, events_for, in_company, run_jobs

CARD = {"title": "Snag list – kitchen", "scale": [{"id": "half", "label": "Half"}, {"id": "all", "label": "All"}],
        "buttons": [{"id": "problem", "label": "Problem", "choices": [{"id": "other", "label": "Other", "noteRequired": True}]}],
        "note": {"text": True}, "ref": {"task": "x1"}}


def api_key(company: str) -> dict:
    with in_company(company):
        cid = db.company_id()
        return {"Authorization": f"Bearer {integrations.new_credentials(cid)['apiKey']}"}


def open_card(api) -> dict:
    return next(c for c in api.get("/me/cards").json()["cards"] if c["state"] == "open" and c["content"].get("scale"))


def pm_task(name: str) -> dict:
    return db.row("SELECT * FROM pm_mock_tasks WHERE name = %(n)s", n=name)


# ---- The person ----

def test_an_answer_reaches_the_pm_app_and_its_status_card_follows(login):
    ravi, amit = login("ravi@paliath.in"), login("amit@paliath.in")
    c = open_card(ravi)
    assert c["content"]["title"] == "False ceiling – living room" and c["projectName"] == "Villa 99"
    r = ravi.post(f"/cards/{c['id']}/answer", {"scale": "75", "note": "Boards fixed"}).json()
    assert r["state"] == "answered" and r["delivery"] == "pending"
    run_jobs({"webhook"})
    after = next(x for x in ravi.get("/me/cards").json()["cards"] if x["id"] == c["id"])
    assert after["delivery"] == "delivered"
    with in_company("Paliath Interiors"):
        t = pm_task("False ceiling – living room")
        assert (t["status"], t["percent"]) == ("in_progress", 75)
    sw = channel_named(amit, "Villa 99", "site-work")
    last = amit.get(f"/channels/{sw['id']}/messages").json()["messages"][0]
    assert last["type"] == "card" and "75%" in last["data"]["content"]["title"]
    assert last["data"]["content"]["lines"] == ["“Boards fixed”"]
    assert any(a["kind"] == "notice" for a in amit.get("/activity").json()["items"])
    # Answering again changes nothing.
    assert ravi.post(f"/cards/{c['id']}/answer", {"scale": "25"}).json()["answer"]["scale"] == "75"


def test_only_what_the_card_offered_is_accepted(login):
    ravi = login("ravi@paliath.in")
    c = open_card(ravi)
    assert ravi.post(f"/cards/{c['id']}/answer", {"scale": "60"}).status_code == 422
    assert ravi.post(f"/cards/{c['id']}/answer", {"scale": "50", "button": "problem"}).status_code == 422
    assert ravi.post(f"/cards/{c['id']}/answer", {"button": "problem", "choice": "other"}).status_code == 422  # needs a note
    assert ravi.post(f"/cards/{c['id']}/answer", {"button": "problem", "choice": "nope"}).status_code == 422
    assert ravi.post(f"/cards/{c['id']}/answer", {"button": "problem", "choice": "other", "note": "Rain"}).status_code == 200


def test_cards_are_only_their_persons(login):
    ravi, suresh, nisha = login("ravi@paliath.in"), login("suresh@paliath.in"), login("nisha@brightline.events")
    c = open_card(ravi)
    for other in (suresh, nisha):  # someone else in the company, and another company
        assert other.post(f"/cards/{c['id']}/answer", {"scale": "50"}).status_code == 404
        assert other.post(f"/cards/{c['id']}/seen").status_code == 404
        assert c["id"] not in {x["id"] for x in other.get("/me/cards").json()["cards"]}


def test_answers_wait_while_the_pm_app_is_down_and_a_refusal_is_shown(login):
    ravi = login("ravi@paliath.in")
    c = open_card(ravi)
    with in_company("Paliath Interiors"):
        from app.mockpm import data

        data.set_down(True)
    ravi.post(f"/cards/{c['id']}/answer", {"scale": "90"})
    run_jobs({"webhook"})
    assert next(x for x in ravi.get("/me/cards").json()["cards"] if x["id"] == c["id"])["delivery"] == "pending"
    with in_company("Paliath Interiors"):
        data.set_down(False)
        db.run("UPDATE pm_mock_tasks SET status = 'done' WHERE name = 'False ceiling – living room'")  # closed meanwhile
    run_jobs({"webhook"}, due_in_seconds=120)
    after = next(x for x in ravi.get("/me/cards").json()["cards"] if x["id"] == c["id"])
    assert (after["delivery"], after["deliveryError"]) == ("refused", "This task is already closed")


def test_open_cards_follow_the_task_in_the_pm_app(login):
    ravi = login("ravi@paliath.in")
    c = open_card(ravi)
    with in_company("Paliath Interiors"):
        t = pm_task("False ceiling – living room")
        data_ = {**{k: t[k] for k in ("id", "projectId", "name", "ownerRef", "status")}, "plannedStart": str(t["plannedStart"]),
                 "plannedFinish": "2030-01-31", "percent": 60}
        from app.mockpm import data

        data.save_task(data_)
    updated = [e["card"] for e in events_for(ravi.user["id"], "card.updated") if e["card"]["id"] == c["id"]][-1]
    assert "31 Jan" in updated["content"]["subtitle"] and updated["content"]["fields"][0]["value"] == "60%"
    with in_company("Paliath Interiors"):
        data.save_task({**data_, "status": "done"})
    after = next(x for x in ravi.get("/me/cards").json()["cards"] if x["id"] == c["id"])
    assert (after["state"], after["closedText"]) == ("closed", "Changed in the PM app")
    assert ravi.post(f"/cards/{c['id']}/answer", {"scale": "50"}).status_code == 409


# ---- The mock PM app's timers ----

def test_a_checkin_is_reminded_then_escalated_to_the_managers(login):
    ravi, amit = login("ravi@paliath.in"), login("amit@paliath.in")
    ravi.post("/internal/bot/evening-checkin")
    run_jobs({"mock_remind"}, due_in_seconds=3 * 3600)
    bot_dm = next(ch for ch in ravi.get("/channels").json()["channels"] if ch["kind"] == "bot")
    assert any((m["data"] or {}).get("nudge") for m in ravi.get(f"/channels/{bot_dm['id']}/messages").json()["messages"])
    run_jobs({"mock_escalate"}, due_in_seconds=3 * 3600)
    sw = channel_named(amit, "Villa 99", "site-work")
    last = amit.get(f"/channels/{sw['id']}/messages").json()["messages"][0]
    assert last["data"]["content"]["title"].startswith("Ravi hasn't updated")


def test_the_daily_plan_queues_summaries_and_checkins_once(client):
    count = "SELECT count(*) FROM jobs WHERE kind IN ('mock_summary', 'mock_checkins', 'mock_plan_day')"
    with in_company("Paliath Interiors"):
        mock.plan_day({})
        first = db.value(count)
        mock.plan_day({})
        assert db.value(count) == first
        assert db.value("SELECT count(*) FROM jobs WHERE kind = 'mock_plan_day'") == 1


def test_what_an_answer_means_for_the_task():
    assert mock.change_for({"scale": "75"}) == {"status": "in_progress", "percent": 75}
    assert mock.change_for({"scale": "done"}) == {"status": "done"}
    assert mock.change_for({"button": "problem", "choice": "labour_short"}) == {"status": "blocked"}
    assert mock.change_for({"button": "not_started"}) is None
    task = {"status": "in_progress", "plannedStart": "2026-10-01"}
    assert mock.needs_update(task, "2026-10-09") and not mock.needs_update(task, "2026-09-30")
    assert not mock.needs_update({**task, "status": "done"}, "2026-10-09")


# ---- The Cards API ----

def test_cards_api_sends_a_card_once_and_reads_it_back(login, client):
    key = api_key("Paliath Interiors")
    body = {**CARD, "id": "snag-1", "to": "ravi@paliath.in"}
    r = client.post("/api/v1/cards", json=body, headers=key)
    assert r.status_code == 201 and r.json()["card"]["state"] == "open"
    assert client.post("/api/v1/cards", json=body, headers=key).status_code == 200  # a retry, no second card
    ravi = login("ravi@paliath.in")
    mine = [c for c in ravi.get("/me/cards").json()["cards"] if c["extId"] == "snag-1"]
    assert len(mine) == 1
    assert client.patch("/api/v1/cards/snag-1", json={"subtitle": "Due Friday"}, headers=key).status_code == 200
    assert client.post("/api/v1/cards/snag-1/nudge", headers=key).status_code == 200
    assert client.post("/api/v1/cards/snag-1/nudge", headers=key).status_code == 429
    ravi.post(f"/cards/{mine[0]['id']}/answer", {"scale": "all"})
    got = client.get("/api/v1/cards/snag-1", headers=key).json()["card"]
    assert got["state"] == "answered" and got["answer"]["scale"] == "all"
    assert client.patch("/api/v1/cards/snag-1", json={"closed": True}, headers=key).status_code == 409


def test_cards_api_refuses_bad_keys_strangers_and_other_companies(client):
    paliath, brightline = api_key("Paliath Interiors"), api_key("Brightline Events")
    body = {**CARD, "id": "snag-2", "to": "ravi@paliath.in"}
    assert client.post("/api/v1/cards", json=body, headers={"Authorization": "Bearer sk_nope"}).status_code == 401
    assert client.post("/api/v1/cards", json=body, headers=brightline).json()["error"]["code"] == "NOT_A_MEMBER"
    assert client.post("/api/v1/cards", json={**body, "project": "no-such"}, headers=paliath).status_code == 404
    bad = {**body, "scale": [{"id": "a", "label": "A"}, {"id": "a", "label": "B"}]}
    assert client.post("/api/v1/cards", json=bad, headers=paliath).status_code == 422
    client.post("/api/v1/cards", json=body, headers=paliath)
    for call in (client.get("/api/v1/cards/snag-2", headers=brightline),
                 client.patch("/api/v1/cards/snag-2", json={"title": "x"}, headers=brightline),
                 client.post("/api/v1/cards/snag-2/nudge", headers=brightline)):
        assert call.status_code == 404
    with db.transaction():
        db.run("UPDATE companies SET status = 'suspended' WHERE name = 'Paliath Interiors'")
    assert client.get("/api/v1/cards/snag-2", headers=paliath).json()["error"]["code"] == "COMPANY_SUSPENDED"


def test_a_rotated_key_works_for_a_day(client):
    old = api_key("Paliath Interiors")
    new = api_key("Paliath Interiors")
    assert client.get("/api/v1/cards/none", headers=old).status_code == 404  # accepted, card unknown
    assert client.get("/api/v1/cards/none", headers=new).status_code == 404
    third = api_key("Paliath Interiors")  # `old` is now two keys back
    assert client.get("/api/v1/cards/none", headers=old).status_code == 401
    assert client.get("/api/v1/cards/none", headers=third).status_code == 404


def test_cards_api_projects_and_channel_messages(login, client):
    key = api_key("Paliath Interiors")
    project = {"name": "Lake House", "client": "Rao family", "members": [
        {"ref": "amit@paliath.in", "role": "manager", "roleName": "Project Manager"},
        {"ref": "ravi@paliath.in", "role": "member", "roleName": "Worker"},
        {"ref": "stranger@nowhere.in", "role": "member"}]}
    r = client.put("/api/v1/projects/LH-1", json=project, headers=key).json()
    assert r["unmatched"] == ["stranger@nowhere.in"]
    ravi = login("ravi@paliath.in")
    assert any(p["name"] == "Lake House" for p in ravi.get("/projects").json()["projects"])
    msg = {"id": "status-lh-1", "project": "LH-1", "card": {"title": "Ravi · Tiling → 50%", "tone": "info"},
           "notify": {"managers": True}}
    first = client.post("/api/v1/messages", json=msg, headers=key).json()["message"]["id"]
    assert client.post("/api/v1/messages", json=msg, headers=key).json()["message"]["id"] == first
    amit = login("amit@paliath.in")
    assert any(a["text"] == "Ravi · Tiling → 50%" for a in amit.get("/activity").json()["items"])
    client.put("/api/v1/projects/LH-1", json={**project, "members": project["members"][:1]}, headers=key)
    assert not any(p["name"] == "Lake House" for p in ravi.get("/projects").json()["projects"])
    client.delete("/api/v1/projects/LH-1", headers=key)
    assert next(p for p in amit.get("/projects").json()["projects"] if p["name"] == "Lake House")["archivedAt"]


# ---- Webhooks to a real PM app ----

def test_webhooks_are_signed_and_a_refusal_is_shown(login, client, monkeypatch):
    with in_company("Paliath Interiors"):
        db.run("UPDATE integrations SET kind = 'http', webhook_url = 'https://pm.example/hooks'")
        creds = integrations.new_credentials(db.company_id())
    sent = []

    def fake_post(url, content, headers, timeout):
        sent.append((url, content, headers))
        return httpx.Response(200, json={"result": "refused", "message": "Task is locked"})

    monkeypatch.setattr(integrations.httpx, "post", fake_post)
    ravi = login("ravi@paliath.in")
    c = open_card(ravi)
    ravi.post(f"/cards/{c['id']}/answer", {"scale": "50"})
    run_jobs({"webhook"})
    url, raw, headers = sent[0]
    assert headers["X-Siteline-Event"] == "card.answered"
    assert headers["X-Siteline-Signature"] == integrations.signature(creds["webhookSecret"], headers["X-Siteline-Timestamp"], raw)
    body = json.loads(raw)
    assert body["person"] == "ravi@paliath.in" and body["answer"] == {"scale": "50"} and body["ref"]["task"]
    after = next(x for x in ravi.get("/me/cards").json()["cards"] if x["id"] == c["id"])
    assert (after["delivery"], after["deliveryError"]) == ("refused", "Task is locked")


def test_after_a_day_of_failures_the_card_says_so_and_admins_hear(login, client, monkeypatch):
    with in_company("Paliath Interiors"):
        db.run("UPDATE integrations SET kind = 'http', webhook_url = 'https://pm.example/hooks'")
    monkeypatch.setattr(integrations.httpx, "post", lambda *a, **k: httpx.Response(500))
    ravi = login("ravi@paliath.in")
    c = open_card(ravi)
    ravi.post(f"/cards/{c['id']}/answer", {"scale": "50"})
    for _ in range(30):
        run_jobs({"webhook"}, due_in_seconds=4000)
    after = next(x for x in ravi.get("/me/cards").json()["cards"] if x["id"] == c["id"])
    assert after["delivery"] == "failed"
    arjun = login("arjun@paliath.in")
    assert any("couldn't reach the PM app" in a["text"] for a in arjun.get("/activity").json()["items"])


def test_people_joining_and_leaving_are_sent_to_the_pm_app(login, client):
    amit = login("amit@paliath.in")
    ravi_id = next(u["id"] for u in amit.get("/users").json()["users"] if u["name"].startswith("Ravi"))
    arjun = login("arjun@paliath.in")
    arjun.post(f"/users/{ravi_id}/deactivate")
    with in_company("Paliath Interiors"):
        hooks = db.rows("SELECT payload FROM jobs WHERE kind = 'webhook'")
    assert any(h["payload"]["event"] == "person.left" and h["payload"]["body"]["person"] == "ravi@paliath.in" for h in hooks)
