"""The bot and the PM app (spec §8, §9.3): check-ins from PM tasks, answers written back as jobs, reminders,
escalations, the daily plan, sync and webhooks."""
import json
import time

from app import db
from app.pm import mock
from conftest import channel_named, in_company, run_jobs


def first_open(api):
    return next(c for c in api.get("/me/checkins").json()["checkins"] if not c["answer"])


def test_an_answer_reaches_the_pm_app_then_the_team(login):
    ravi, amit = login("ravi@paliath.in"), login("amit@paliath.in")
    c = first_open(ravi)
    assert c["taskName"] == c["task"]["name"] == "False ceiling – living room" and c["projectName"] == "Villa 99"
    r = ravi.post(f"/checkins/{c['id']}/answer", {"kind": "progress", "percent": 75}).json()
    assert r["answer"]["percent"] == 75 and r["pmWrite"] == "pending"  # "Saving to the PM app…"
    sw = channel_named(amit, "Villa 99", "site-work")
    cards = lambda: [m for m in amit.get(f"/channels/{sw['id']}/messages").json()["messages"] if m["type"] == "status_card"]
    before = len(cards())
    run_jobs({"pm_write"})
    after = next(x for x in ravi.get("/me/checkins").json()["checkins"] if x["id"] == c["id"])
    assert after["pmWrite"] == "saved" and after["task"]["percent"] == 75
    with in_company("Paliath Interiors"):
        assert mock.get_task(c["taskId"])["percent"] == 75
    assert len(cards()) == before + 1 and cards()[0]["data"]["taskName"] == "False ceiling – living room"
    assert any(a["kind"] == "checkin_result" for a in amit.get("/activity").json()["items"])
    # Answering again changes nothing, and the PM app is written once.
    assert ravi.post(f"/checkins/{c['id']}/answer", {"kind": "done"}).json()["answer"]["percent"] == 75
    run_jobs({"pm_write"})
    with in_company("Paliath Interiors"):
        assert mock.get_task(c["taskId"])["status"] == "in_progress"


def test_the_pm_app_being_down_only_delays_the_answer(login):
    ravi = login("ravi@paliath.in")
    c = first_open(ravi)
    with in_company("Paliath Interiors"):
        mock.set_down(True)
    ravi.post(f"/checkins/{c['id']}/answer", {"kind": "progress", "percent": 90})
    run_jobs({"pm_write"})
    assert next(x for x in ravi.get("/me/checkins").json()["checkins"] if x["id"] == c["id"])["pmWrite"] == "pending"
    with db.transaction():
        job = db.row("SELECT * FROM jobs WHERE kind = 'pm_write'")
    assert job["status"] == "pending" and job["attempts"] == 1 and "isn't answering" in job["lastError"]
    with in_company("Paliath Interiors"):
        mock.set_down(False)
    run_jobs({"pm_write"}, due_in_seconds=120)  # the retry
    assert next(x for x in ravi.get("/me/checkins").json()["checkins"] if x["id"] == c["id"])["pmWrite"] == "saved"
    with in_company("Paliath Interiors"):
        assert mock.get_task(c["taskId"])["percent"] == 90


def test_the_pm_app_can_refuse_and_the_card_closes_when_the_task_is_done_there(login):
    ravi = login("ravi@paliath.in")
    c = first_open(ravi)
    with in_company("Paliath Interiors"):
        mock.save_task({**mock.get_task(c["taskId"]), "status": "done", "percent": 100})  # webhook: task.updated
    assert next(x for x in ravi.get("/me/checkins").json()["checkins"] if x["id"] == c["id"])["closed"] is True
    ravi.post(f"/checkins/{c['id']}/answer", {"kind": "progress", "percent": 50})
    run_jobs({"pm_write"})
    after = next(x for x in ravi.get("/me/checkins").json()["checkins"] if x["id"] == c["id"])
    assert after["pmWrite"] == "refused" and after["pmError"] == "This task is already closed"


def test_not_started_tells_the_pm_app_nothing(login):
    ravi = login("ravi@paliath.in")
    c = first_open(ravi)
    r = ravi.post(f"/checkins/{c['id']}/answer", {"kind": "not_started"}).json()
    assert r["pmWrite"] is None
    with db.transaction():
        assert db.value("SELECT count(*) FROM jobs WHERE kind = 'pm_write'") == 0


def test_opening_the_bot_asks_once_per_active_task(login):
    imran = login("imran@paliath.in")
    assert imran.post("/bot/checkins").json()["asked"] >= 1
    assert imran.post("/bot/checkins").json()["asked"] == 0
    names = {c["taskName"] for c in imran.get("/me/checkins").json()["checkins"]}
    assert "Kitchen carcass" in names and "Wardrobe – kids bedroom" not in names  # not started yet: not asked


def test_the_bot_rechecks_with_the_pm_app_before_asking(login):
    imran = login("imran@paliath.in")
    with in_company("Paliath Interiors"):
        task = db.row("SELECT * FROM pm_mock_tasks WHERE name = 'Kitchen carcass'")
        # Finished in the PM app, but the webhook never arrived: the saved copy still says in progress.
        db.run("UPDATE pm_mock_tasks SET status = 'done', percent = 100 WHERE id = %(id)s", id=task["id"])
    imran.post("/bot/checkins")
    assert "Kitchen carcass" not in {c["taskName"] for c in imran.get("/me/checkins").json()["checkins"]}
    with in_company("Paliath Interiors"):
        assert db.value("SELECT status FROM pm_tasks WHERE pm_task_id = %(id)s", id=task["id"]) == "done"


def test_reminder_then_escalation_each_once(login):
    ravi, amit, suresh = login("ravi@paliath.in"), login("amit@paliath.in"), login("suresh@paliath.in", "Paliath Interiors")
    ravi.post("/internal/bot/evening-checkin")
    c = [x for x in ravi.get("/me/checkins").json()["checkins"] if not x["answer"]][-1]
    assert run_jobs({"remind"}, due_in_seconds=61 * 60) == 1
    assert run_jobs({"remind"}, due_in_seconds=61 * 60) == 0  # never twice
    assert run_jobs({"escalate"}, due_in_seconds=121 * 60) == 1
    activity = amit.get("/activity").json()["items"]
    assert any(a["kind"] == "escalation" and c["taskName"] in a["text"] for a in activity)
    assert any(a["kind"] == "escalation" for a in suresh.get("/activity").json()["items"])  # both Villa 99 managers
    with db.transaction():
        assert db.value("SELECT count(*) FROM jobs WHERE kind = 'send_push' AND payload->>'title' = 'No update yet'") == 2


def test_answering_cancels_the_reminder(login):
    ravi = login("ravi@paliath.in")
    ravi.post("/internal/bot/evening-checkin")
    c = [x for x in ravi.get("/me/checkins").json()["checkins"] if not x["answer"]][-1]
    ravi.post(f"/checkins/{c['id']}/answer", {"kind": "started"})
    assert run_jobs({"remind", "escalate"}, due_in_seconds=3 * 3600) == 0


def test_the_daily_plan_queues_summaries_and_checkins_once(client):
    from app.jobs.handlers import plan_day

    count = "SELECT count(*) FROM jobs WHERE kind IN ('morning_summary', 'evening_checkins', 'plan_day')"
    with in_company("Paliath Interiors"):
        plan_day({})
        first = db.value(count)
        plan_day({})  # running twice queues nothing more
        assert db.value(count) == first
        assert db.value("SELECT count(*) FROM jobs WHERE kind = 'plan_day'") == 1  # tomorrow's plan, once


def test_morning_summary_lists_active_tasks(login):
    ravi = login("ravi@paliath.in")
    ravi.post("/internal/bot/morning-summary")
    bot = next(c for c in ravi.get("/channels").json()["channels"] if c["kind"] == "bot")
    summary = next(m for m in ravi.get(f"/channels/{bot['id']}/messages").json()["messages"]
                   if (m["data"] or {}).get("kind") == "morning_summary")
    assert [t["name"] for t in summary["data"]["tasks"]] == ["False ceiling – living room", "False ceiling – master bedroom"]


def test_webhooks_need_the_company_secret_and_apply_once(client, login):
    from app.routers.webhooks import signature
    from app.services.secrets import encrypt

    with db.transaction():
        cid = db.value("SELECT id FROM companies WHERE name = 'Paliath Interiors'")
        db.run("UPDATE pm_links SET webhook_secret = %(s)s WHERE company_id = %(c)s", s=encrypt("shh"), c=cid)
    with in_company("Paliath Interiors"):
        task = db.row("SELECT * FROM pm_tasks WHERE name = 'False ceiling – living room'")
    event = {"id": "evt-1", "type": "task.updated", "data": {
        "id": task["pmTaskId"], "projectId": task["pmProjectId"], "name": "False ceiling – living room",
        "plannedStart": task["plannedStart"], "plannedFinish": "2031-01-01", "ownerRef": "ravi@paliath.in",
        "status": "in_progress", "percent": 60}}
    body = json.dumps(event).encode()
    ts = str(int(time.time()))
    post = lambda sig, t=ts: client.post(f"/webhooks/pm/{cid}", content=body, headers={"X-Signature": sig, "X-Timestamp": t,
                                                                                         "Content-Type": "application/json"})
    assert post("bad").status_code == 403
    assert post(signature("shh", "1000", body), "1000").status_code == 403  # too old
    assert post(signature("shh", ts, body)).json() == {"accepted": True, "repeat": False}
    assert post(signature("shh", ts, body)).json() == {"accepted": True, "repeat": True}
    ravi = login("ravi@paliath.in")
    c = first_open(ravi)
    assert c["task"]["plannedFinish"] == "2031-01-01" and c["task"]["percent"] == 60


def test_pm_changes_reach_siteline(login):
    amit, ravi = login("amit@paliath.in"), login("ravi@paliath.in")
    c = first_open(ravi)
    with in_company("Paliath Interiors"):
        mock.save_task({**mock.get_task(c["taskId"]), "ownerRef": "manjunath@paliath.in"})  # reassigned
    assert next(x for x in ravi.get("/me/checkins").json()["checkins"] if x["id"] == c["id"])["closed"] is True
    with in_company("Paliath Interiors"):
        oith = db.row("SELECT * FROM pm_mock_projects WHERE name = 'OITH'")
        mock.set_project_status(oith["id"], "closed")
    oith_space = next(p for p in amit.get("/projects").json()["projects"] if p["name"] == "OITH")
    assert oith_space["archivedAt"]
    with in_company("Paliath Interiors"):
        db.run("DELETE FROM pm_mock_members WHERE person_ref = 'imran@paliath.in'")
        from app.pm.sync import full_sync

        full_sync()
    imran = login("imran@paliath.in")
    assert "Villa 99" not in {p["name"] for p in imran.get("/projects").json()["projects"]}


def test_people_the_pm_app_names_but_siteline_lacks_are_listed(login):
    arjun = login("arjun@paliath.in")
    with in_company("Paliath Interiors"):
        villa = db.row("SELECT id FROM pm_mock_projects WHERE name = 'Villa 99'")
        db.insert("pm_mock_members", {"companyId": db.company_id(), "projectId": villa["id"], "personRef": "newhire@paliath.in",
                                      "name": "New Hire", "role": "member", "roleName": "Worker"})
        from app.pm.sync import full_sync

        full_sync()
    status = arjun.get("/integration").json()
    assert status["connected"] and "newhire@paliath.in" in status["unmatched"]
    assert login("ravi@paliath.in").get("/integration").status_code == 403


def test_open_checkin_cards_refresh_when_the_pm_app_changes_the_task(login):
    from conftest import events_for

    ravi = login("ravi@paliath.in")
    c = first_open(ravi)
    with in_company("Paliath Interiors"):
        task = mock.get_task(c["taskId"])
        mock.save_task({**task, "plannedFinish": "2031-02-02"})  # webhook: task.updated
    pushed = [e["checkin"] for e in events_for(ravi.user["id"], "checkin.updated") if e["checkin"]["id"] == c["id"]]
    assert pushed and pushed[-1]["task"]["plannedFinish"] == "2031-02-02"
    before = len(events_for(ravi.user["id"], "checkin.updated"))
    with in_company("Paliath Interiors"):
        mock.save_task({**mock.get_task(c["taskId"])})  # nothing the card shows changed: no event
        assert len(events_for(ravi.user["id"], "checkin.updated")) == before
        mock.delete_task(c["taskId"])  # webhook: task.deleted
    closed = [e["checkin"] for e in events_for(ravi.user["id"], "checkin.updated") if e["checkin"]["id"] == c["id"]]
    assert closed[-1]["closed"] is True and closed[-1]["task"] is None
