from app.core import uuid7
from app.services import limits


def _general(api):
    return next(c for c in api.get("/channels").json()["channels"] if c["kind"] == "company" and c["name"] == "general")["id"]


def _send(api, ch):
    return api.post(f"/channels/{ch}/messages", {"id": uuid7(), "type": "text", "body": "hi", "data": None})


def test_changes_are_limited_per_person_and_reads_are_not(login, monkeypatch):
    monkeypatch.setitem(limits.LIMITS, "write", (3, "minute"))
    ravi, meera = login("ravi@paliath.in"), login("meera@paliath.in")
    ch = _general(ravi)
    assert [_send(ravi, ch).status_code for _ in range(3)] == [200] * 3
    r = _send(ravi, ch)
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"
    assert ravi.get(f"/channels/{ch}/messages").status_code == 200  # reading never counts
    assert _send(meera, ch).status_code == 200  # someone else's limit is their own


def test_search_uploads_and_invites_have_their_own_limits(login, monkeypatch):
    for kind in ("search", "upload", "invite"):
        monkeypatch.setitem(limits.LIMITS, kind, (1, "minute"))
    meera = login("meera@paliath.in")
    ch = _general(meera)
    search = lambda: meera.get(f"/channels/{ch}/messages/search", params={"q": "site"}).status_code  # noqa: E731
    assert (search(), search()) == (200, 429)
    png = ("a.png", b"\x89PNG\r\n\x1a\n" + b"1" * 32, "image/png")
    assert meera.post("/uploads", files={"file": png}).status_code == 200
    assert meera.post("/uploads", files={"file": png}).status_code == 429
    invite = lambda n: meera.post("/invites", {"id": uuid7(), "identifier": f"new{n}@crew.example", "name": "New Person", "role": "member"})  # noqa: E731
    assert invite(1).status_code == 200 and invite(2).status_code == 429
