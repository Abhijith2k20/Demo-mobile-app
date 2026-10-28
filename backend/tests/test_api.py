from app.core import uuid7
from app.notify import flush_all
from app.rules import normalize_task_change
from conftest import channel_named, events_for, project_id, task_named

# ---- Auth ----


def test_sign_in_is_by_email_case_insensitive(client):
    r = client.post("/auth/otp/verify", json={"email": "  Ravi@Paliath.IN ", "code": "123456"})
    assert r.status_code == 200
    assert r.json()["user"]["name"] == "Ravi Kumar"


def test_wrong_code_and_unknown_email_look_the_same(client):
    a = client.post("/auth/otp/verify", json={"email": "ravi@paliath.in", "code": "000000"}).json()["error"]["code"]
    b = client.post("/auth/otp/verify", json={"email": "nobody@paliath.in", "code": "123456"}).json()["error"]["code"]
    assert a == b == "OTP_INVALID"


def test_five_wrong_codes_lock_the_email(client):
    for _ in range(4):
        client.post("/auth/otp/verify", json={"email": "ravi@paliath.in", "code": "000000"})
    r = client.post("/auth/otp/verify", json={"email": "ravi@paliath.in", "code": "000000"})
    assert r.json()["error"]["code"] == "OTP_TOO_MANY_ATTEMPTS"


def test_requests_need_a_token_and_refresh_works(client, login):
    assert client.get("/me").json()["error"]["code"] == "AUTH_EXPIRED"
    api = login("ravi@paliath.in")
    r = client.post("/auth/refresh", json={"refreshToken": api.refresh})
    assert client.get("/me", headers={"Authorization": f"Bearer {r.json()['accessToken']}"}).status_code == 200


def test_validation_errors_use_the_standard_format(login):
    api = login("arjun@paliath.in")
    r = api.post("/projects", json={"id": uuid7(), "name": "x", "client": ""})
    err = r.json()["error"]
    assert r.status_code == 422 and err["code"] == "VALIDATION_FAILED"
    assert err["details"]["fields"] == {"name": "Give the project a name", "client": "Who is the client?"}
    assert err["request_id"]


# ---- Visibility and permissions ----


def test_members_only_see_their_projects_and_hidden_ones_are_404(login):
    ravi, arjun = login("ravi@paliath.in"), login("arjun@paliath.in")
    assert [p["name"] for p in ravi.get("/projects").json()["projects"]] == ["Villa 99"]
    assert len(arjun.get("/projects").json()["projects"]) == 3
    oith = project_id(arjun, "OITH")
    assert ravi.get(f"/projects/{oith}").status_code == 404


def test_project_permissions_come_from_the_server(login):
    amit, ravi = login("amit@paliath.in"), login("ravi@paliath.in")
    amit_perms = amit.get(f"/projects/{project_id(amit, 'Villa 99')}").json()["access"]["permissions"]
    ravi_access = ravi.get(f"/projects/{project_id(ravi, 'Villa 99')}").json()["access"]
    assert "task.edit_any" in amit_perms and "project.archive" in amit_perms and "project.delete" not in amit_perms
    assert ravi_access["role"] == "member" and ravi_access["permissions"] == ["task.create", "task.update_own"]
    assert login("arjun@paliath.in").get("/me").json()["permissions"][:2] == ["company.users", "project.create"]


def test_private_channel_is_hidden_from_members_not_in_it(login):
    ravi = login("ravi@paliath.in")
    names = {c["name"] for c in ravi.get("/channels").json()["channels"] if c["projectId"]}
    assert "qs" not in names and "site-work" in names


# ---- Tasks ----


def test_member_can_update_own_progress_but_not_dates(login):
    ravi = login("ravi@paliath.in")
    t = task_named(ravi, "Villa 99", "False ceiling – living room")
    assert ravi.patch(f"/tasks/{t['id']}", {"plannedFinish": "2030-01-01"}).json()["error"]["code"] == "FORBIDDEN"
    r = ravi.patch(f"/tasks/{t['id']}", {"percent": 100}).json()
    assert r["status"] == "done_pending_confirmation" and r["percent"] == 100  # waits for a manager


def test_manager_confirms_and_shift_moves_both_dates(login):
    amit = login("amit@paliath.in")
    t = task_named(amit, "Villa 99", "False ceiling – kids bedroom")
    moved = amit.post(f"/tasks/{t['id']}/shift?days=2").json()
    assert (moved["plannedStart"], moved["plannedFinish"]) != (t["plannedStart"], t["plannedFinish"])
    assert moved["varianceDays"] == t["varianceDays"] + 2
    assert login("ravi@paliath.in").post(f"/tasks/{t['id']}/shift?days=1").status_code == 403


def test_task_rules_fill_in_consequences():
    task = {"status": "not_started", "percent": 0, "actualStart": None, "actualFinish": None}
    out = normalize_task_change(task, {"percent": 50}, True, today="2026-10-26")
    assert out == {"percent": 50, "status": "in_progress", "actualStart": "2026-10-26"}  # unchanged fields are dropped


def test_new_task_validation_and_idempotency(login):
    amit = login("amit@paliath.in")
    pid = project_id(amit, "Villa 99")
    bad = amit.post(f"/projects/{pid}/tasks", {"id": uuid7(), "name": "X", "phase": "Civil",
                                               "plannedStart": "2026-01-05", "plannedFinish": "2026-01-01"})
    assert bad.json()["error"]["details"]["fields"] == {"plannedFinish": "Finish must be on or after start"}
    body = {"id": uuid7(), "name": "Skirting", "phase": "Finishing", "plannedStart": "2026-11-01", "plannedFinish": "2026-11-02"}
    first, again = amit.post(f"/projects/{pid}/tasks", body).json(), amit.post(f"/projects/{pid}/tasks", body).json()
    assert first["id"] == again["id"]
    assert sum(1 for t in amit.get(f"/projects/{pid}/tasks").json()["tasks"] if t["name"] == "Skirting") == 1


def test_my_tasks_are_grouped_by_the_server(login):
    mine = login("ravi@paliath.in").get("/me/tasks").json()
    assert {t["name"] for t in mine["today"]} >= {"False ceiling – living room", "False ceiling – master bedroom"}
    assert all(not t["isLate"] or t["plannedFinish"] for t in mine["today"])


# ---- Messages ----


def test_posting_updates_unread_and_sends_events_only_to_the_audience(login):
    amit, ravi, rohan = login("amit@paliath.in"), login("ravi@paliath.in"), login("rohan@paliath.in")
    sw = channel_named(amit, "Villa 99", "site-work")
    before = channel_named(ravi, "Villa 99", "site-work")["unreadCount"]
    msg = amit.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "Hello site", "data": None}).json()
    assert channel_named(ravi, "Villa 99", "site-work")["unreadCount"] == before + 1
    assert any(e["message"]["id"] == msg["id"] for e in events_for(ravi.user["id"], "message.new"))
    assert not any(e.get("message", {}).get("id") == msg["id"] for e in events_for(rohan.user["id"]))  # not in #site-work
    ravi.post(f"/channels/{sw['id']}/read", {"upToMessageId": msg["id"]})
    assert channel_named(ravi, "Villa 99", "site-work")["unreadCount"] == 0


def test_message_permissions_are_per_viewer(login):
    amit, ravi = login("amit@paliath.in"), login("ravi@paliath.in")
    sw = channel_named(ravi, "Villa 99", "site-work")
    mine = ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "ok", "data": None}).json()
    assert mine["canEdit"] and mine["canDelete"] and not mine["canPin"]
    seen_by_amit = amit.get(f"/channels/{sw['id']}/messages?limit=1").json()["messages"][0]
    assert seen_by_amit["id"] == mine["id"] and not seen_by_amit["canEdit"] and seen_by_amit["canPin"]
    assert amit.patch(f"/messages/{mine['id']}", {"body": "hack"}).json()["error"]["code"] == "FORBIDDEN"


def test_mentions_and_announcements(login):
    amit, ravi = login("amit@paliath.in"), login("ravi@paliath.in")
    sw = channel_named(amit, "Villa 99", "site-work")
    amit.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "@Ravi hi", "data": {"mentions": [ravi.user["id"]]}})
    feed = ravi.get("/activity").json()
    assert feed["items"][0]["kind"] == "mention" and feed["unreadCount"] >= 1
    ravi.post("/activity/read")
    assert ravi.get("/activity").json()["unreadCount"] == 0
    ann = channel_named(ravi, None, "announcements")
    assert not ann["canPost"]
    r = ravi.post(f"/channels/{ann['id']}/messages", {"id": uuid7(), "type": "text", "body": "x", "data": None})
    assert r.json()["error"]["code"] == "CHANNEL_READ_ONLY"


def test_dm_is_created_by_first_open(login):
    ravi, rohan = login("ravi@paliath.in"), login("rohan@paliath.in")
    assert ravi.get(f"/dms/{rohan.user['id']}").json()["channel"] is None
    ch = ravi.post("/dms", {"userId": rohan.user["id"]}).json()["channel"]
    assert ravi.post("/dms", {"userId": rohan.user["id"]}).json()["channel"]["id"] == ch["id"]
    assert ch["peerId"] == rohan.user["id"]


# ---- People ----


def test_invite_and_deactivate(login, client):
    arjun, meera = login("arjun@paliath.in"), login("meera@paliath.in")
    body = {"id": uuid7(), "name": "Deepa Nair", "email": "Deepa@Paliath.in", "companyRole": "admin"}
    assert meera.post("/users", body).status_code == 403  # only the owner adds admins
    assert arjun.post("/users", {**body, "email": "ravi@paliath.in"}).json()["error"]["code"] == "EMAIL_TAKEN"
    assert arjun.post("/users", body).json()["user"]["email"] == "deepa@paliath.in"
    deepa = login("deepa@paliath.in")
    kinds = {c["kind"] for c in deepa.get("/channels").json()["channels"]}
    assert {"company", "bot", "project"} <= kinds  # an admin reads every project channel
    assert meera.post(f"/users/{deepa.user['id']}/deactivate").status_code == 403  # admins can't remove admins
    assert arjun.post(f"/users/{deepa.user['id']}/deactivate").json()["user"]["isActive"] is False
    assert deepa.get("/me").json()["error"]["code"] == "AUTH_EXPIRED"
    assert client.post("/auth/otp/verify", json={"email": "deepa@paliath.in", "code": "123456"}).status_code == 400


# ---- Bot ----


def test_checkin_answer_updates_task_and_reports(login):
    ravi, amit = login("ravi@paliath.in"), login("amit@paliath.in")
    pending = [c for c in ravi.get("/me/checkins").json()["checkins"] if not c["answer"]]
    assert len(pending) == 1
    c = pending[0]
    r = ravi.post(f"/checkins/{c['id']}/answer", {"kind": "progress", "percent": 75})
    assert r.json()["answer"]["percent"] == 75
    task = ravi.get(f"/tasks/{c['taskId']}").json()
    assert task["task"]["percent"] == 75 and task["history"][0]["via"] == "checkin"
    flush_all()
    assert any(a["kind"] == "checkin_result" for a in amit.get("/activity").json()["items"])
    # Answering twice changes nothing.
    assert ravi.post(f"/checkins/{c['id']}/answer", {"kind": "done"}).json()["answer"]["percent"] == 75


def test_opening_the_bot_asks_once_per_task(login):
    imran = login("imran@paliath.in")
    asked = imran.post("/bot/checkins").json()["asked"]
    assert asked >= 1 and imran.post("/bot/checkins").json()["asked"] == 0


# ---- Projects ----


def test_create_project_archive_and_delete(login):
    arjun, amit = login("arjun@paliath.in"), login("amit@paliath.in")
    pid = uuid7()
    p = arjun.post("/projects", {"id": pid, "name": "Hebbal flat", "client": "Rao", "address": "Hebbal"}).json()
    assert p["access"]["permissions"] and p["delayDays"] == 0
    assert {c["name"] for c in arjun.get(f"/projects/{pid}/channels").json()["channels"]} == {"general", "design", "site-work", "qs"}
    villa = project_id(amit, "Villa 99")
    assert amit.patch(f"/projects/{villa}", {"archived": True}).json()["access"]["permissions"] == ["project.archive"]
    sw = channel_named(amit, "Villa 99", "site-work")
    r = amit.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "x", "data": None})
    assert r.json()["error"]["code"] == "PROJECT_ARCHIVED"
    assert amit.delete(f"/projects/{pid}").status_code == 404  # not visible to Amit
    assert arjun.delete(f"/projects/{pid}").json() == {"deleted": True}


def test_member_management_keeps_one_manager(login):
    kavya = login("kavya@paliath.in")
    rv = project_id(kavya, "RV University")
    r = kavya.patch(f"/projects/{rv}/members/{kavya.user['id']}", {"role": "member"})
    assert r.json()["error"]["details"]["fields"] == {"role": "A project needs at least one manager"}


def test_owner_and_admins_are_never_added_to_a_project(login):
    kavya = login("kavya@paliath.in")
    rv = project_id(kavya, "RV University")
    people = kavya.get("/users").json()["users"]
    admin = next(u for u in people if u["companyRole"] != "member")
    worker = next(u for u in people if u["companyRole"] == "member")
    assert admin["joinsProjects"] is False and worker["joinsProjects"] is True
    r = kavya.post(f"/projects/{rv}/members", {"userId": admin["id"], "role": "member", "jobTitle": "Worker"})
    assert r.json()["error"]["details"]["fields"] == {"userId": "The owner and admins already see every project"}
    assert kavya.get("/meta").json()["rolesInEveryChannel"] == ["manager"]


def test_websocket_requires_a_token(client, login):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws?token=nope") as ws:
            ws.receive_text()
    api = login("ravi@paliath.in")
    with client.websocket_connect(f"/ws?token={api.token}") as ws:
        ws.send_text("ping")  # accepted and kept open


# ---- Audit fixes ----


def test_asking_for_a_new_code_does_not_reset_the_lock(client):
    bad = {"email": "ravi@paliath.in", "code": "000000"}
    for _ in range(3):
        client.post("/auth/otp/verify", json=bad)
    client.post("/auth/otp/request", json={"email": "ravi@paliath.in"})
    client.post("/auth/otp/verify", json=bad)
    assert client.post("/auth/otp/verify", json=bad).json()["error"]["code"] == "OTP_TOO_MANY_ATTEMPTS"


def test_task_owner_must_be_on_the_project(login):
    amit, lakshmi = login("amit@paliath.in"), login("lakshmi@paliath.in")  # Lakshmi isn't on Villa 99
    t = task_named(amit, "Villa 99", "Study table")
    r = amit.patch(f"/tasks/{t['id']}", {"ownerId": lakshmi.user["id"]})
    assert r.json()["error"]["details"]["fields"] == {"ownerId": "Pick someone on this project"}


def test_photo_upload_and_links_come_from_the_server(login):
    ravi = login("ravi@paliath.in")
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    up = ravi.post("/uploads", files={"file": ("site.png", png, "image/png")}).json()
    assert ravi.client.get(up["url"].split("testserver")[-1]).content == png
    assert ravi.post("/uploads", files={"file": ("notes.txt", b"hi", "text/plain")}).status_code == 422
    sw = channel_named(ravi, "Villa 99", "site-work")
    send = lambda a: ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "image", "body": None, "data": {"attachments": [a]}})
    # A made-up link is refused; a real upload gets the server's own link whatever the app sent.
    assert send({"id": "x1", "kind": "image", "uri": "https://evil.example/pixel.png", "uploadId": None}).status_code == 422
    msg = send({"id": "x2", "kind": "image", "uri": "https://evil.example/pixel.png", "uploadId": up["uploadId"]}).json()
    assert msg["data"]["attachments"][0]["uri"] == up["url"]


def test_project_updates_and_files(login):
    amit, ravi = login("amit@paliath.in"), login("ravi@paliath.in")
    oith, villa = project_id(amit, "OITH"), project_id(ravi, "Villa 99")
    files = amit.get(f"/projects/{oith}/files").json()["files"]
    assert files and {f["kind"] for f in files} <= {"photo", "file"}
    # Ravi isn't in Villa 99 #qs or #design, so nothing from them shows in his Files tab.
    names = {f.get("name") for f in ravi.get(f"/projects/{villa}/files").json()["files"]}
    assert "TV_unit_revC.pdf" not in names
    assert amit.get(f"/projects/{oith}/updates").status_code == 200


# ---- Second audit ----


def _ids(s, project, channel=None):
    from app.store import S

    st = S()
    pid = next(p["id"] for p in st.projects.values() if p["name"] == project)
    if channel is None:
        return pid
    return pid, next(c["id"] for c in st.channels.values() if c["projectId"] == pid and c["name"] == channel)


def test_reusing_an_id_never_returns_someone_elses_record(login):
    from app.store import S

    ravi, kavya = login("ravi@paliath.in"), login("kavya@paliath.in")
    _, qs = _ids(S(), "Villa 99", "qs")
    secret = next(m for m in S().messages.values() if m["channelId"] == qs)
    villa, sw = _ids(S(), "Villa 99", "site-work")
    oith = _ids(S(), "OITH")
    oith_task = next(t for t in S().tasks.values() if t["projectId"] == oith)
    r = ravi.post(f"/channels/{sw}/messages", {"id": secret["id"], "type": "text", "body": "x", "data": None})
    assert r.status_code == 422 and "Rate for Italian marble" not in r.text
    assert ravi.post("/projects", {"id": oith, "name": "xx", "client": "y"}).status_code == 403
    r = ravi.post(f"/projects/{villa}/tasks", {"id": oith_task["id"], "name": "x", "phase": "Civil",
                                               "plannedStart": "2026-01-01", "plannedFinish": "2026-01-02"})
    assert r.status_code == 422 and oith_task["name"] not in r.text
    rv = _ids(S(), "RV University")
    rv_qs = next(c for c in S().channels.values() if c["projectId"] == rv and c["name"] == "qs")
    kavya_villa = _ids(S(), "Villa 99")  # Kavya is a member there, not a manager: no channel create
    assert kavya.post(f"/projects/{kavya_villa}/channels", {"id": rv_qs["id"], "name": "x-y"}).status_code == 403
    # A real retry still returns the same message.
    mine = {"id": uuid7(), "type": "text", "body": "retry me", "data": None}
    first, again = ravi.post(f"/channels/{sw}/messages", mine).json(), ravi.post(f"/channels/{sw}/messages", mine).json()
    assert first["id"] == again["id"]


def test_messages_sent_late_still_count_as_unread_and_ids_cant_reorder(login):
    import time

    from app.store import S

    ravi, amit = login("ravi@paliath.in"), login("amit@paliath.in")
    _, sw = _ids(S(), "Villa 99", "site-work")
    newest = amit.get(f"/channels/{sw}/messages?limit=1").json()["messages"][0]["id"]
    amit.post(f"/channels/{sw}/read", {"upToMessageId": newest})
    unread = lambda: next(c for c in amit.get("/channels").json()["channels"] if c["id"] == sw)["unreadCount"]
    assert unread() == 0
    h = f"{int(time.time() * 1000) - 3_600_000:012x}"  # written offline an hour ago, sent now
    ravi.post(f"/channels/{sw}/messages", {"id": f"{h[:8]}-{h[8:12]}-7000-8000-000000000abc", "type": "text", "body": "late", "data": None})
    assert unread() == 1
    ravi.post(f"/channels/{sw}/messages", {"id": "ffffffff-ffff-7fff-bfff-ffffffffffff", "type": "text", "body": "max id", "data": None})
    ravi.post(f"/channels/{sw}/messages", {"id": uuid7(), "type": "text", "body": "really newest", "data": None})
    newest_two = [m["body"] for m in amit.get(f"/channels/{sw}/messages?limit=2").json()["messages"]]
    assert newest_two == ["really newest", "max id"]
    # Paging uses the same order: the page before "max id" starts with "late".
    page = amit.get(f"/channels/{sw}/messages?limit=1&before=ffffffff-ffff-7fff-bfff-ffffffffffff").json()["messages"]
    assert page[0]["body"] == "late"


def test_wrong_code_lock_expires_and_tokens_dont_pile_up(client, login, monkeypatch):
    from app.routers import auth
    from app.store import S

    bad = {"email": "ravi@paliath.in", "code": "000000"}
    for _ in range(5):
        client.post("/auth/otp/verify", json=bad)
    assert client.post("/auth/otp/verify", json=bad).json()["error"]["code"] == "OTP_TOO_MANY_ATTEMPTS"
    real = auth.now_ms
    monkeypatch.setattr(auth, "now_ms", lambda: real() + auth.LOCK_SECONDS * 1000 + 1)
    assert client.post("/auth/otp/verify", json={"email": "ravi@paliath.in", "code": "123456"}).status_code == 200
    monkeypatch.setattr(auth, "now_ms", real)
    api = login("amit@paliath.in")
    before = len(S().tokens)
    for _ in range(5):
        latest = client.post("/auth/refresh", json={"refreshToken": api.refresh}).json()["accessToken"]
    assert len(S().tokens) == before  # each refresh replaces the old access token
    assert api.get("/me").json()["error"]["code"] == "AUTH_EXPIRED"  # the replaced one no longer works
    client.post("/auth/logout", headers={"Authorization": f"Bearer {latest}"})
    assert not any(t["userId"] == api.user["id"] for t in S().tokens.values())


# ---- The company's own setup, and logic the app no longer does ----


def test_setup_comes_from_the_server_in_the_readers_language(client, login):
    assert client.get("/company").json()["name"] == "Paliath Interiors"  # no token: shown on sign-in
    accounts = client.get("/auth/demo-accounts", headers={"Accept-Language": "hi"}).json()["accounts"]
    assert [a["companyRole"] for a in accounts[:2]] == ["owner", "admin"]
    assert {"email": "ravi@paliath.in", "name": "Ravi Kumar", "companyRole": "member", "jobTitle": "कामगार"} in accounts
    amit = login("amit@paliath.in")
    meta = amit.client.get("/meta", headers={**amit.headers, "Accept-Language": "kn-IN"}).json()
    assert meta["stages"][0] == {"key": "design", "label": "ಡಿಸೈನ್"}
    assert {"name": "Worker", "label": "ಕೆಲಸಗಾರ", "managersOnly": False} in meta["jobTitles"]
    assert meta["defaultJobTitle"] == "Worker"
    assert {"key": "Damage", "label": "ಹಾನಿ", "inCheckins": False} in meta["problemTypes"]
    assert amit.get("/meta").json()["stages"][0]["label"] == "Design"
    # Simple (big-button) layout follows the job titles the company marked simple.
    assert login("ravi@paliath.in").get("/me").json()["simpleMode"] is True
    assert amit.get("/me").json()["simpleMode"] is False


def test_setup_checks_stages_and_job_titles(login):
    amit = login("amit@paliath.in")
    villa = project_id(amit, "Villa 99")
    assert amit.get(f"/projects/{villa}").json()["nextStage"] == "finishing"
    r = amit.patch(f"/projects/{villa}", {"stage": "launch"})
    assert r.json()["error"]["details"]["fields"] == {"stage": "Pick one of the company's stages"}
    ravi = login("ravi@paliath.in")
    r = amit.patch(f"/projects/{villa}/members/{ravi.user['id']}", {"jobTitle": "Project Manager"})
    assert r.json()["error"]["details"]["fields"] == {"jobTitle": "This job title is for managers"}


def test_schedule_is_filtered_and_ordered_by_the_server(login):
    amit = login("amit@paliath.in")
    villa = project_id(amit, "Villa 99")
    everything = amit.get(f"/projects/{villa}/tasks").json()
    assert everything["total"] == len(everything["tasks"]) > 0
    names = [p["name"] for p in everything["phases"]]
    assert everything["currentPhase"] in names and names == list(dict.fromkeys(t["phase"] for t in everything["tasks"]))
    assert sum(p["total"] for p in everything["phases"]) == everything["total"]
    assert everything["window"]["from"] <= everything["window"]["to"]
    progress = amit.get(f"/projects/{villa}").json()["progress"]
    assert progress["total"] == everything["total"] and progress["done"] == sum(p["done"] for p in everything["phases"])
    mine = amit.get(f"/projects/{villa}/tasks", params={"owner": "me"}).json()
    assert mine["tasks"] and all(t["ownerId"] == amit.user["id"] for t in mine["tasks"])
    assert mine["total"] == everything["total"] and mine["phases"] == everything["phases"]
    late = amit.get(f"/projects/{villa}/tasks", params={"due": "overdue"}).json()["tasks"]
    assert all(t["isLate"] for t in late)


def test_new_task_dates_come_from_the_server(login):
    amit = login("amit@paliath.in")
    villa = project_id(amit, "Villa 99")
    d = amit.get(f"/projects/{villa}/task-defaults", params={"phase": "Painting"}).json()
    assert d["phase"] == "Painting" and d["plannedStart"] <= d["plannedFinish"] and "Painting" in d["phaseChoices"]
    t = amit.post(f"/projects/{villa}/tasks", {"id": uuid7(), "name": "Touch-up", "phase": "Painting"}).json()
    assert (t["plannedStart"], t["plannedFinish"]) == (d["plannedStart"], d["plannedFinish"])
    assert t["channelId"] == channel_named(amit, "Villa 99", "site-work")["id"]  # the company's work channel


def test_channels_come_in_display_order(login):
    amit = login("amit@paliath.in")
    chans = amit.get("/channels").json()["channels"]
    villa = project_id(amit, "Villa 99")
    assert [c["name"] for c in chans if c["projectId"] == villa] == ["general", "design", "site-work", "qs"]
    company = [c["name"] for c in chans if c["kind"] == "company"]
    assert company[0] == "announcements"
    kinds = [c["kind"] for c in chans]
    assert kinds == sorted(kinds, key=["project", "company", "bot", "dm"].index)
