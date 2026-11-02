"""Companies never see each other (spec §9.7), and only the Siteline team creates them (§9.2)."""
import psycopg
import pytest

from app import db
from app.core import uuid7
from conftest import events_for, in_company, run_jobs


def test_row_level_security_hides_other_companies(client):
    with in_company("Brightline Events"):
        assert {p["name"] for p in db.rows("SELECT name FROM projects")} == {"Sharma Wedding", "TechConf 2026"}
        paliath = db.value("SELECT id FROM companies WHERE name = 'Paliath Interiors'")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.insert("projects", {"id": uuid7(), "companyId": paliath, "name": "Smuggled"})
    with db.transaction():  # no company: nothing
        for table in db.PER_COMPANY_TABLES:
            assert db.value(f"SELECT count(*) FROM {table}") == 0, table


def test_ids_from_another_company_are_404(login):
    ravi, nisha = login("ravi@paliath.in"), login("nisha@brightline.events")
    channel = next(c for c in nisha.get("/channels").json()["channels"] if c["projectId"] and c["lastMessage"])
    project = {"id": channel["projectId"]}
    message = nisha.get(f"/channels/{channel['id']}/messages").json()["messages"][0]
    for path in (f"/projects/{project['id']}", f"/channels/{channel['id']}", f"/channels/{channel['id']}/messages",
                 f"/messages/{message['id']}/thread", f"/dms/{nisha.user['id']}"):
        assert ravi.get(path).status_code == 404, path
    assert ravi.post(f"/channels/{channel['id']}/messages", {"id": uuid7(), "type": "text", "body": "hi", "data": None}).status_code == 404
    assert ravi.post(f"/channels/{channel['id']}/join").status_code == 404
    assert ravi.put(f"/messages/{message['id']}/reactions/👍", {"on": True}).status_code == 404


def test_lists_events_and_people_stay_inside_the_company(login):
    ravi, nisha = login("ravi@paliath.in"), login("nisha@brightline.events")
    names = {u["name"] for u in ravi.get("/users").json()["users"]}
    assert "Nisha Rao" not in names and "Suresh Gowda" in names
    chans = {c["id"] for c in ravi.get("/channels").json()["channels"]}
    general = next(c for c in nisha.get("/channels").json()["channels"] if c["kind"] == "company" and c["name"] == "general")
    assert general["id"] not in chans
    nisha.post(f"/channels/{general['id']}/messages", {"id": uuid7(), "type": "text", "body": "Brightline only", "data": None})
    assert not any(e.get("message", {}).get("body") == "Brightline only" for e in events_for(ravi.user["id"]))


def test_events_reach_only_sockets_signed_in_to_that_company():
    import asyncio

    from app.events import Hub

    class Socket:
        def __init__(self):
            self.sent = []

        async def send_text(self, text):
            self.sent.append(text)

    hub, paliath, brightline = Hub(), Socket(), Socket()
    hub.add("suresh", "paliath-id", paliath)  # the same person, signed in to each company on two phones
    hub.add("suresh", "brightline-id", brightline)
    asyncio.run(hub.deliver("brightline-id", ["suresh"], {"type": "message.new"}))
    assert paliath.sent == [] and len(brightline.sent) == 1


def test_a_message_id_used_in_another_company_is_refused_without_leaking(login):
    ravi, nisha = login("ravi@paliath.in"), login("nisha@brightline.events")
    channel = next(c for c in nisha.get("/channels").json()["channels"] if c["kind"] == "company" and c["lastMessage"])
    theirs = nisha.get(f"/channels/{channel['id']}/messages").json()["messages"][0]
    mine = next(c for c in ravi.get("/channels").json()["channels"] if c["kind"] == "company" and c["name"] == "general")
    r = ravi.post(f"/channels/{mine['id']}/messages", {"id": theirs["id"], "type": "text", "body": "x", "data": None})
    assert r.status_code == 422 and theirs["body"] not in r.text


def test_signed_file_links_name_their_company(login, client):
    ravi = login("ravi@paliath.in")
    up = ravi.post("/uploads", files={"file": ("a.png", b"\x89PNG\r\n\x1a\n" + b"1" * 32, "image/png")}).json()
    path = up["url"].split("localhost:8000")[-1]
    with db.transaction():
        other = db.value("SELECT id FROM companies WHERE name = 'Brightline Events'")
    parts = path.split("/")
    parts[2] = other  # same signature, another company
    assert client.get("/".join(parts)).status_code == 404
    assert client.get(path).status_code == 200


def test_platform_creates_a_company_with_its_owner(client):
    body = {"name": "Acme Fitouts", "template": "interiors", "ownerName": "Asha Menon", "ownerIdentifier": "asha@acme.example",
            "pmCompanyId": "acme-77"}
    assert client.post("/platform/companies", json=body).status_code == 403
    assert client.post("/platform/companies", json=body, headers={"X-Platform-Key": "wrong"}).status_code == 403
    c = client.post("/platform/companies", json=body, headers={"X-Platform-Key": "dev-platform-key"}).json()["company"]
    assert c["slug"] == "acme-fitouts"
    run_jobs({"send_invite"})
    client.post("/auth/otp/request", json={"identifier": "asha@acme.example"})
    v = client.post("/auth/otp/verify", json={"identifier": "asha@acme.example", "code": "123456"}).json()
    h = {"Authorization": f"Bearer {v['accessToken']}"}
    client.post(f"/auth/invites/{v['invites'][0]['id']}/accept", headers=h)
    s = client.post("/auth/session", json={"companyId": c["id"]}, headers=h).json()
    assert s["user"]["companyRole"] == "owner" and "user.invite_admin" in s["permissions"]
    names = {ch["name"] for ch in client.get("/channels", headers={"Authorization": f"Bearer {s['accessToken']}"}).json()["channels"]}
    assert names == {"announcements", "general", "Siteline Bot"}
    with db.transaction():
        assert db.value("SELECT count(*) FROM audit_log WHERE action = 'company.created'") == 1


def test_a_suspended_company_cannot_be_opened(login, client):
    from app.services import companies

    ravi = login("ravi@paliath.in")
    suresh = login("suresh@paliath.in", "Brightline Events")
    with db.transaction():
        cid = db.value("SELECT id FROM companies WHERE name = 'Paliath Interiors'")
        companies.set_status(cid, "suspended", "test")
    assert ravi.get("/me").json()["error"]["code"] == "AUTH_EXPIRED"
    client.post("/auth/otp/request", json={"identifier": "ravi@paliath.in"})
    v = client.post("/auth/otp/verify", json={"identifier": "ravi@paliath.in", "code": "123456"}).json()
    assert v["companies"] == [] and "session" not in v
    assert suresh.get("/me").status_code == 200  # his other company works


def test_platform_panel_needs_a_signed_in_admin(client):
    assert "Sign in" in client.get("/platform").text
    assert client.post("/platform/companies/new", data={"name": "X"}).status_code in (401, 422)
    client.post("/platform/login", data={"email": "admin@siteline.app"})
    r = client.post("/platform/verify", data={"email": "admin@siteline.app", "code": "123456"}, follow_redirects=False)
    assert r.status_code == 303 and "siteline_platform" in r.headers["set-cookie"]
    page = client.get("/platform", cookies={"siteline_platform": r.cookies["siteline_platform"]}).text
    assert "Paliath Interiors" in page and "Brightline Events" in page
    assert "Rate for Italian marble" not in page  # never a company's messages
