"""Sign-in codes, sessions, switching company, invites, roles (spec §9.4–9.6)."""
import pytest

from app import config, db
from app.core import uuid7
from conftest import sent_code


def code(client, identifier, value=None):
    """Asks for a code and signs in with it (or with `value`, to try a wrong one)."""
    client.post("/auth/otp/request", json={"identifier": identifier})
    from app.services.accounts import normalize_identifier

    try:
        sent = sent_code(normalize_identifier(identifier))
    except Exception:
        sent = ""
    return client.post("/auth/otp/verify", json={"identifier": identifier, "code": value or sent or "000000"})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_sign_in_by_email_in_any_case_and_never_by_phone(client):
    r = code(client, "  Ravi@Paliath.IN ").json()
    assert r["session"]["user"]["name"] == "Ravi Kumar" and r["session"]["company"]["name"] == "Paliath Interiors"
    assert "phone" not in r["session"]["user"]
    for not_email in ("not an address", "9800000005", "+919800000005"):
        assert client.post("/auth/otp/request", json={"identifier": not_email}).status_code == 422


def test_unknown_addresses_get_the_same_reply_and_no_code(client):
    known = client.post("/auth/otp/request", json={"identifier": "ravi@paliath.in"}).json()
    unknown = client.post("/auth/otp/request", json={"identifier": "nobody@paliath.in"}).json()
    assert known == unknown
    assert code(client, "nobody@paliath.in").json()["error"]["code"] == "OTP_INVALID"
    with db.transaction():
        assert not db.value("SELECT 1 FROM otp_codes WHERE identifier = 'nobody@paliath.in'")


def test_five_wrong_codes_burn_the_code_and_requests_are_rate_limited(client):
    client.post("/auth/otp/request", json={"identifier": "ravi@paliath.in"})
    for _ in range(4):
        assert client.post("/auth/otp/verify", json={"identifier": "ravi@paliath.in", "code": "000000"}).json()["error"]["code"] == "OTP_INVALID"
    r = client.post("/auth/otp/verify", json={"identifier": "ravi@paliath.in", "code": "000000"})
    assert r.json()["error"]["code"] == "OTP_TOO_MANY_ATTEMPTS"
    assert client.post("/auth/otp/verify", json={"identifier": "ravi@paliath.in", "code": "123456"}).json()["error"]["code"] == "OTP_TOO_MANY_ATTEMPTS"
    for _ in range(4):  # 5 requests an hour per address
        client.post("/auth/otp/request", json={"identifier": "ravi@paliath.in"})
    assert client.post("/auth/otp/request", json={"identifier": "ravi@paliath.in"}).json()["error"]["code"] == "RATE_LIMITED"


def test_codes_are_stored_hashed():
    from app.services import accounts

    assert "123456" not in accounts._hash("ravi@paliath.in123456")


def test_production_refuses_a_fixed_code(monkeypatch):
    monkeypatch.setattr(config, "PRODUCTION", True)
    monkeypatch.setattr(config, "DEVELOPMENT", False)
    monkeypatch.setattr(config, "SECRET", "x" * 40)
    monkeypatch.setattr(config, "PLATFORM_KEY", "y" * 30)
    monkeypatch.setattr(config, "FIXED_CODE", "123456")
    with pytest.raises(RuntimeError, match="FIXED_CODE"):
        config.check()


def test_requests_need_a_company_session_and_refresh_rotates(client, login):
    assert client.get("/me").json()["error"]["code"] == "AUTH_EXPIRED"
    api = login("ravi@paliath.in")
    r = client.post("/auth/refresh", json={"refreshToken": api.refresh}).json()
    assert client.get("/me", headers=bearer(r["accessToken"])).status_code == 200
    assert api.get("/me").json()["error"]["code"] == "AUTH_EXPIRED"  # the old access token was replaced
    # Using the old refresh token again means it was copied: the whole session ends.
    assert client.post("/auth/refresh", json={"refreshToken": api.refresh}).json()["error"]["code"] == "AUTH_EXPIRED"
    assert client.get("/me", headers=bearer(r["accessToken"])).json()["error"]["code"] == "AUTH_EXPIRED"


def test_logout_ends_only_this_session(client, login):
    phone, laptop = login("ravi@paliath.in"), login("ravi@paliath.in")
    phone.post("/auth/logout")
    assert phone.get("/me").json()["error"]["code"] == "AUTH_EXPIRED"
    assert laptop.get("/me").status_code == 200


def test_two_companies_pick_and_switch(client):
    r = code(client, "suresh@paliath.in").json()
    assert "session" not in r and sorted(c["name"] for c in r["companies"]) == ["Brightline Events", "Paliath Interiors"]
    assert client.get("/me", headers=bearer(r["accessToken"])).json()["error"]["code"] == "NO_COMPANY"
    paliath = next(c for c in r["companies"] if c["name"] == "Paliath Interiors")
    brightline = next(c for c in r["companies"] if c["name"] == "Brightline Events")
    s1 = client.post("/auth/session", json={"companyId": paliath["id"]}, headers=bearer(r["accessToken"])).json()
    assert {p["name"] for p in client.get("/projects", headers=bearer(s1["accessToken"])).json()["projects"]} == {"Villa 99", "OITH"}
    assert {c["name"] for c in s1["companies"]} == {"Paliath Interiors", "Brightline Events"}
    s2 = client.post("/auth/switch", json={"companyId": brightline["id"]}, headers=bearer(s1["accessToken"])).json()
    assert {p["name"] for p in client.get("/projects", headers=bearer(s2["accessToken"])).json()["projects"]} == {"Sharma Wedding"}
    assert client.get("/me", headers=bearer(s1["accessToken"])).json()["error"]["code"] == "AUTH_EXPIRED"  # switching ends the old one
    other = code(client, "ravi@paliath.in").json()["session"]
    assert client.post("/auth/switch", json={"companyId": brightline["id"]},
                       headers=bearer(other["accessToken"])).json()["error"]["code"] == "NOT_A_MEMBER"


def test_invite_by_email_then_join(login, client):
    nisha = login("nisha@brightline.events")
    assert nisha.post("/invites", {"id": uuid7(), "identifier": "+91 98000 00077", "name": "Ganesh K",
                                   "role": "member"}).status_code == 422  # no phone invites
    inv = nisha.post("/invites", {"id": uuid7(), "identifier": "Ganesh@Crew.Example", "name": "Ganesh K", "role": "member"}).json()
    assert inv["invite"]["identifier"] == "ganesh@crew.example"
    assert [i["name"] for i in nisha.get("/invites").json()["invites"]] == ["Ganesh K"]
    with db.transaction():
        sent = db.rows("SELECT payload FROM jobs WHERE kind = 'send_invite'")
    assert sent[-1]["payload"]["identifier"] == "ganesh@crew.example" and "link" in sent[-1]["payload"]
    r = code(client, "ganesh@crew.example").json()
    assert r["companies"] == [] and r["invites"][0]["companyName"] == "Brightline Events" and "session" not in r
    h = bearer(r["accessToken"])
    client.post(f"/auth/invites/{r['invites'][0]['id']}/accept", headers=h)
    s = client.post("/auth/session", json={"companyId": r["invites"][0]["companyId"]}, headers=h).json()
    assert s["user"]["name"] == "Ganesh K" and s["user"]["companyRole"] == "member"
    kinds = {c["kind"] for c in client.get("/channels", headers=bearer(s["accessToken"])).json()["channels"]}
    assert kinds == {"company", "bot"}  # project channels come when the PM app adds them to a project
    assert nisha.get("/invites").json()["invites"] == []


def test_invite_rules(login):
    arjun, meera, ravi = login("arjun@paliath.in"), login("meera@paliath.in"), login("ravi@paliath.in")
    admin = {"id": uuid7(), "identifier": "deepa@paliath.in", "name": "Deepa Nair", "role": "admin"}
    assert meera.post("/invites", admin).status_code == 403  # only the owner adds admins
    assert ravi.post("/invites", {**admin, "role": "member"}).status_code == 403
    assert arjun.post("/invites", {**admin, "identifier": "ravi@paliath.in"}).json()["error"]["code"] == "ALREADY_MEMBER"
    assert arjun.post("/invites", {**admin, "role": "owner"}).status_code == 422
    first = arjun.post("/invites", admin).json()["invite"]
    assert arjun.post(f"/invites/{first['id']}/resend").status_code == 200
    arjun.delete(f"/invites/{first['id']}")
    assert arjun.get("/invites").json()["invites"] == []


def test_guests_see_only_their_channels(login, client):
    amit, arjun = login("amit@paliath.in"), login("arjun@paliath.in")
    sw = next(c for c in amit.get("/channels").json()["channels"] if c["name"] == "site-work"
              and c["projectId"] == next(p["id"] for p in amit.get("/projects").json()["projects"] if p["name"] == "Villa 99"))
    arjun.post("/invites", {"id": uuid7(), "identifier": "client@sharma.example", "name": "Mr Sharma", "role": "guest",
                            "channelIds": [sw["id"]]})
    r = code(client, "client@sharma.example").json()
    h = bearer(r["accessToken"])
    client.post(f"/auth/invites/{r['invites'][0]['id']}/accept", headers=h)
    g = bearer(client.post("/auth/session", json={"companyId": r["invites"][0]["companyId"]}, headers=h).json()["accessToken"])
    names = {(c["kind"], c["name"]) for c in client.get("/channels", headers=g).json()["channels"]}
    assert names == {("project", "site-work"), ("bot", "Siteline Bot")}  # no company channels, no other project channels
    browse = client.get(f"/projects/{sw['projectId']}/channels", headers=g).json()["channels"]
    assert [c["name"] for c in browse] == ["site-work"]
    people = {u["name"] for u in client.get("/users", headers=g).json()["users"]}
    assert "Rohan Desai" not in people and "Ravi Kumar" in people  # only people who share a channel
    assert client.get("/me", headers=g).json()["permissions"] == []
    rohan = login("rohan@paliath.in")
    assert client.post("/dms", json={"userId": rohan.user["id"]}, headers=g).status_code == 404


def test_roles_and_deactivation_are_per_company(login, client):
    nisha, arjun = login("nisha@brightline.events"), login("arjun@paliath.in")
    suresh_bl = login("suresh@paliath.in", "Brightline Events")
    suresh_pi = login("suresh@paliath.in", "Paliath Interiors")
    meera = login("meera@paliath.in")
    rohan = next(u for u in arjun.get("/users").json()["users"] if u["name"] == "Rohan Desai")
    assert meera.patch(f"/users/{rohan['id']}", {"role": "admin"}).status_code == 403  # admins can't make admins
    assert meera.patch(f"/users/{rohan['id']}", {"role": "guest"}).json()["user"]["companyRole"] == "guest"
    assert meera.patch(f"/users/{arjun.user['id']}", {"role": "member"}).status_code == 403  # nobody changes the owner
    assert nisha.post(f"/users/{suresh_bl.user['id']}/deactivate").json()["user"]["isActive"] is False
    assert suresh_bl.get("/me").json()["error"]["code"] == "AUTH_EXPIRED"
    assert suresh_pi.get("/me").status_code == 200  # Paliath isn't affected
    assert [c["name"] for c in code(client, "suresh@paliath.in").json()["companies"]] == ["Paliath Interiors"]


def test_profile_name_and_notifications(login):
    ravi = login("ravi@paliath.in")
    me = ravi.patch("/me", {"name": "Ravi K", "notify": {"level": "important"}}).json()
    assert me["user"]["name"] == "Ravi K" and me["notify"] == {"level": "important"}
    assert ravi.patch("/me", {"notify": {"level": "loud"}}).status_code == 422
    assert ravi.put("/me/push-tokens", {"token": "ExponentPushToken[abc123xyz]", "platform": "android"}).json() == {"saved": True}


def test_deleting_an_account_keeps_messages_as_former_member(login, client):
    ravi, amit = login("ravi@paliath.in"), login("amit@paliath.in")
    assert ravi.delete("/me").json() == {"deleted": True}
    people = {u["id"]: u for u in amit.get("/users").json()["users"]}
    assert people[ravi.user["id"]]["name"] == "Former member" and people[ravi.user["id"]]["email"] is None
    assert code(client, "ravi@paliath.in").json()["error"]["code"] == "OTP_INVALID"
