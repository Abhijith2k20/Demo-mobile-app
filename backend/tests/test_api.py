"""Chat, channels, projects and files inside one company."""
from app import db
from app.core import uuid7
from conftest import channel_named, events_for, in_company, project_id, sent_code


def test_validation_errors_use_the_standard_format(login):
    api = login("arjun@paliath.in")
    r = api.post("/projects", json={"id": uuid7(), "name": "x"})
    err = r.json()["error"]
    assert r.status_code == 422 and err["code"] == "VALIDATION_FAILED"
    assert err["details"]["fields"] == {"name": "Give the project a name"}
    assert err["request_id"]


# ---- Visibility and permissions ----


def test_members_only_see_their_projects_and_hidden_ones_are_404(login):
    ravi, arjun = login("ravi@paliath.in"), login("arjun@paliath.in")
    assert [p["name"] for p in ravi.get("/projects").json()["projects"]] == ["Villa 99"]
    assert len(arjun.get("/projects").json()["projects"]) == 3
    oith = project_id(arjun, "OITH")
    assert ravi.get(f"/projects/{oith}").status_code == 404


def test_project_permissions_come_from_the_server(login):
    arjun, amit = login("arjun@paliath.in"), login("amit@paliath.in")
    villa = arjun.get(f"/projects/{project_id(arjun, 'Villa 99')}").json()
    assert {"project.manage", "channel.manage", "project.delete"} <= set(villa["access"]["permissions"])
    assert amit.get(f"/projects/{project_id(amit, 'Villa 99')}").json()["access"]["permissions"] == []
    assert "project.create" in arjun.get("/me").json()["permissions"]
    assert "project.create" not in amit.get("/me").json()["permissions"]

def test_private_channel_is_hidden_from_members_not_in_it(login):
    ravi = login("ravi@paliath.in")
    names = {c["name"] for c in ravi.get("/channels").json()["channels"] if c["projectId"]}
    assert "qs" not in names and "site-work" in names


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
    meera, ravi = login("meera@paliath.in"), login("ravi@paliath.in")
    sw = channel_named(ravi, "Villa 99", "site-work")
    mine = ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "text", "body": "ok", "data": None}).json()
    assert mine["canEdit"] and mine["canDelete"] and not mine["canPin"]
    seen_by_admin = meera.get(f"/channels/{sw['id']}/messages?limit=1").json()["messages"][0]
    assert seen_by_admin["id"] == mine["id"] and not seen_by_admin["canEdit"] and seen_by_admin["canPin"]
    assert seen_by_admin["canDelete"]  # Owner/Admin delete anyone's
    assert meera.patch(f"/messages/{mine['id']}", {"body": "hack"}).json()["error"]["code"] == "FORBIDDEN"
    amit = login("amit@paliath.in")
    assert amit.patch(f"/messages/{mine['id']}", {"pinned": True}).json()["error"]["code"] == "FORBIDDEN"
    assert amit.put(f"/messages/{mine['id']}/reactions/👍", {"on": True}).json()["reactions"] == {"👍": [amit.user["id"]]}

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


def test_dm_is_created_by_first_open_and_pushes_the_other_person(login):
    ravi, rohan = login("ravi@paliath.in"), login("rohan@paliath.in")
    assert ravi.get(f"/dms/{rohan.user['id']}").json()["channel"] is None
    ch = ravi.post("/dms", {"userId": rohan.user["id"]}).json()["channel"]
    assert ravi.post("/dms", {"userId": rohan.user["id"]}).json()["channel"]["id"] == ch["id"]
    assert ch["peerId"] == rohan.user["id"]
    ravi.post(f"/channels/{ch['id']}/messages", {"id": uuid7(), "type": "text", "body": "hello", "data": None})
    with db.transaction():
        pushes = db.rows("SELECT payload FROM jobs WHERE kind = 'send_push'")
    assert any(p["payload"]["userId"] == rohan.user["id"] and p["payload"]["body"] == "hello" for p in pushes)


def test_reusing_an_id_never_returns_someone_elses_record(login):
    ravi, kavya = login("ravi@paliath.in"), login("kavya@paliath.in")
    with in_company("Paliath Interiors"):
        secret = db.row("""SELECT m.id FROM messages m JOIN channels c ON c.id = m.channel_id JOIN projects p ON p.id = c.project_id
                           WHERE p.name = 'Villa 99' AND c.name = 'qs' LIMIT 1""")
        rv_qs = db.row("""SELECT c.id FROM channels c JOIN projects p ON p.id = c.project_id
                          WHERE p.name = 'RV University' AND c.name = 'qs'""")
    sw = channel_named(ravi, "Villa 99", "site-work")["id"]
    r = ravi.post(f"/channels/{sw}/messages", {"id": secret["id"], "type": "text", "body": "x", "data": None})
    assert r.status_code == 422 and "Rate for Italian marble" not in r.text
    villa = project_id(kavya, "Villa 99")  # Kavya is a member there, not a manager: no channel create
    assert kavya.post(f"/projects/{villa}/channels", {"id": rv_qs["id"], "name": "x-y"}).status_code == 403
    mine = {"id": uuid7(), "type": "text", "body": "retry me", "data": None}
    first, again = ravi.post(f"/channels/{sw}/messages", mine).json(), ravi.post(f"/channels/{sw}/messages", mine).json()
    assert first["id"] == again["id"]  # a real retry still returns the same message


def test_messages_sent_late_still_count_as_unread_and_ids_cant_reorder(login):
    import time

    ravi, amit = login("ravi@paliath.in"), login("amit@paliath.in")
    sw = channel_named(amit, "Villa 99", "site-work")["id"]
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
    page = amit.get(f"/channels/{sw}/messages?limit=1&before=ffffffff-ffff-7fff-bfff-ffffffffffff").json()["messages"]
    assert page[0]["body"] == "late"


# ---- Files ----


def test_uploads_are_checked_by_content_and_links_are_signed(login, client):
    ravi = login("ravi@paliath.in")
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    up = ravi.post("/uploads", files={"file": ("site.png", png, "image/png")}).json()
    path = up["url"].split("localhost:8000")[-1]
    assert client.get(path).content == png
    assert client.get(path.replace("sig=", "sig=0")).status_code == 404  # tampered
    fake = ravi.post("/uploads", files={"file": ("photo.jpg", b"not really a photo", "image/jpeg")})
    assert fake.status_code == 422  # the name and the claimed type aren't trusted
    sw = channel_named(ravi, "Villa 99", "site-work")
    send = lambda a: ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "image", "body": None, "data": {"attachments": [a]}})
    assert send({"id": "x1", "kind": "image", "uri": "https://evil.example/pixel.png", "uploadId": None}).status_code == 422
    msg = send({"id": "x2", "kind": "image", "uri": "https://evil.example/pixel.png", "uploadId": up["uploadId"]}).json()
    assert "/files/" in msg["data"]["attachments"][0]["uri"] and "evil" not in msg["data"]["attachments"][0]["uri"]


def test_voice_notes_and_pdfs(login):
    ravi = login("ravi@paliath.in")
    m4a = b"\x00\x00\x00\x20ftypM4A " + b"0" * 64
    pdf = b"%PDF-1.7\n" + b"0" * 64
    voice = ravi.post("/uploads", files={"file": ("note.m4a", m4a, "audio/mp4")}, data={"kind": "voice"}).json()
    doc = ravi.post("/uploads", files={"file": ("plan.pdf", pdf, "application/pdf")}, data={"kind": "file"}).json()
    sw = channel_named(ravi, "Villa 99", "site-work")
    v = ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "voice", "body": None,
                                                     "data": {"uploadId": voice["uploadId"], "durationSec": 4}}).json()
    f = ravi.post(f"/channels/{sw['id']}/messages", {"id": uuid7(), "type": "file", "body": None,
                                                     "data": {"uploadId": doc["uploadId"]}}).json()
    assert v["data"]["uri"] and f["data"]["name"] == "plan.pdf" and f["data"]["size"] == len(pdf)
    too_big = ravi.post("/uploads", files={"file": ("big.png", b"\x89PNG\r\n\x1a\n" + b"0" * (10 * 1024 * 1024), "image/png")})
    assert too_big.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_project_files(login):
    amit, ravi = login("amit@paliath.in"), login("ravi@paliath.in")
    oith, villa = project_id(amit, "OITH"), project_id(ravi, "Villa 99")
    files = amit.get(f"/projects/{oith}/files").json()["files"]
    assert files and {f["kind"] for f in files} <= {"photo", "file"}
    names = {f.get("name") for f in ravi.get(f"/projects/{villa}/files").json()["files"]}
    assert "TV_unit_revC.pdf" not in names  # Ravi isn't in Villa 99 #design


# ---- Projects ----


def test_people_on_a_project_join_its_public_channels(login):
    meera, ravi, amit, kavya = (login(f"{n}@paliath.in") for n in ("meera", "ravi", "amit", "kavya"))
    mine = lambda api: {c["name"] for c in api.get("/channels").json()["channels"] if c["projectId"] == pid}  # noqa: E731
    pid = uuid7()
    p = meera.post("/projects", {"id": pid, "name": "Lake House"}).json()
    assert p["members"] == []
    chans = meera.get(f"/projects/{pid}/channels").json()["channels"]
    assert [c["name"] for c in chans] == ["general"] and chans[0]["memberIds"] == []  # admins aren't listed
    assert not any(x["name"] == "Lake House" for x in ravi.get("/projects").json()["projects"])  # nobody else, yet
    assert amit.post("/projects", {"id": uuid7(), "name": "Mine"}).status_code == 403  # members can't create projects
    # Added to the project: in every public channel.
    meera.post(f"/projects/{pid}/members", {"userId": ravi.user["id"]})
    assert mine(ravi) == {"general"}
    # A new public channel gets everyone on the project; a private one only the people picked.
    meera.post(f"/projects/{pid}/channels", {"id": uuid7(), "name": "Tiling"})
    meera.post(f"/projects/{pid}/channels", {"id": uuid7(), "name": "Money", "isPrivate": True, "memberIds": [kavya.user["id"]]})
    assert mine(ravi) == {"general", "tiling"}
    assert mine(kavya) == {"general", "tiling", "money"}  # added to a channel = on the project = in its public ones
    # Someone added later joins the public channels, plus private ones picked.
    money = next(c for c in meera.get(f"/projects/{pid}/channels").json()["channels"] if c["name"] == "money")
    meera.post(f"/projects/{pid}/members", {"userId": amit.user["id"], "channelIds": [money["id"]]})
    assert mine(amit) == {"general", "tiling", "money"}
    # The Owner and Admins can still take someone out of one channel; the rest stay.
    tiling = next(c for c in meera.get(f"/projects/{pid}/channels").json()["channels"] if c["name"] == "tiling")
    meera.patch(f"/projects/{pid}/members/{ravi.user['id']}", {"channelIds": []})
    assert mine(ravi) == set()
    meera.patch(f"/channels/{tiling['id']}", {"memberIds": [ravi.user["id"]]})
    assert mine(ravi) == {"tiling"} and "tiling" not in mine(amit)
    assert amit.post(f"/projects/{pid}/channels", {"id": uuid7(), "name": "extra"}).status_code == 403
    assert meera.patch(f"/projects/{pid}", {"name": "Lake House 2"}).json()["name"] == "Lake House 2"
    meera.delete(f"/projects/{pid}/members/{ravi.user['id']}")
    assert mine(ravi) == set()


def test_owner_and_admins_are_never_added_to_a_project(login):
    kavya = login("kavya@paliath.in")
    people = kavya.get("/users").json()["users"]
    admin = next(u for u in people if u["companyRole"] in ("owner", "admin"))
    worker = next(u for u in people if u["companyRole"] == "member")
    assert admin["joinsProjects"] is False and worker["joinsProjects"] is True

def test_websocket_needs_a_token(client, login):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws?token=nope") as ws:
            ws.receive_text()
    api = login("ravi@paliath.in")
    with client.websocket_connect(f"/ws?token={api.token}") as ws:
        ws.send_text("ping")  # accepted and kept open


def test_the_same_app_for_every_company(client, login):
    accounts = client.get("/auth/demo-accounts").json()["accounts"]
    assert {"identifier": "ravi@paliath.in", "email": "ravi@paliath.in", "name": "Ravi Kumar", "companyRole": "member",
            "company": "Paliath Interiors"} in accounts
    assert all("@" in a["identifier"] for a in accounts)  # everyone signs in by email
    amit = login("amit@paliath.in")
    assert amit.get("/me").json()["company"]["name"] == "Paliath Interiors"
    assert "simpleMode" not in amit.get("/me").json()

def test_channels_come_in_display_order(login):
    amit = login("amit@paliath.in")
    chans = amit.get("/channels").json()["channels"]
    villa = project_id(amit, "Villa 99")
    assert [c["name"] for c in chans if c["projectId"] == villa] == ["general", "design", "qs", "site-work"]
    assert [c["name"] for c in chans if c["kind"] == "company"][0] == "announcements"
    kinds = [c["kind"] for c in chans]
    assert kinds == sorted(kinds, key=["project", "company", "bot", "dm"].index)


def test_a_new_company_starts_empty_and_makes_its_own_projects(client):
    r = client.post("/platform/companies", json={"name": "Solo Builders", "ownerName": "Sam Owner",
                                                 "ownerIdentifier": "sam@solo.example", "pmKind": "none"},
                    headers={"X-Platform-Key": "dev-platform-key"})
    assert r.status_code == 200, r.text
    client.post("/auth/otp/request", json={"identifier": "sam@solo.example"})
    v = client.post("/auth/otp/verify", json={"identifier": "sam@solo.example", "code": sent_code("sam@solo.example")}).json()
    h = {"Authorization": f"Bearer {v['accessToken']}"}
    client.post(f"/auth/invites/{v['invites'][0]['id']}/accept", headers=h)
    s = client.post("/auth/session", json={"companyId": v["invites"][0]["companyId"]}, headers=h).json()
    h = {"Authorization": f"Bearer {s['accessToken']}"}
    pid = uuid7()
    p = client.post("/projects", json={"id": pid, "name": "Hebbal flat", "client": "Rao", "address": "Hebbal"}, headers=h).json()
    assert p["access"]["permissions"] and "linked" not in p
    chans = {c["name"] for c in client.get(f"/projects/{pid}/channels", headers=h).json()["channels"]}
    assert chans == {"general"}
    assert client.patch(f"/projects/{pid}", json={"archived": True}, headers=h).json()["archivedAt"]
    assert client.delete(f"/projects/{pid}", headers=h).json() == {"deleted": True}

