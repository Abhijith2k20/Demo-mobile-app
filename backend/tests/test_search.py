from app.core import uuid7


def _general(api):
    return next(c for c in api.get("/channels").json()["channels"] if c["kind"] == "company" and c["name"] == "general")


def _send(api, channel_id, body, **extra):
    m = {"id": uuid7(), "type": "text", "body": body, "data": None, **extra}
    assert api.post(f"/channels/{channel_id}/messages", m).status_code in (200, 201)
    return m["id"]


def test_search_finds_messages_and_replies_in_the_whole_channel(login):
    ravi = login("ravi@paliath.in")
    ch = _general(ravi)["id"]
    first = _send(ravi, ch, "Grout for the master bath is 50% done")
    _send(ravi, ch, "Grout colour confirmed", threadParentId=first)
    gone = _send(ravi, ch, "Grout delivery cancelled")
    ravi.delete(f"/messages/{gone}")
    _send(ravi, ch, "Nothing to see here")

    found = ravi.get(f"/channels/{ch}/messages/search", params={"q": "grout"}).json()["messages"]
    assert [m["body"] for m in found] == ["Grout colour confirmed", "Grout for the master bath is 50% done"]  # newest first, no deleted
    # % and _ are plain characters, not wildcards.
    assert [m["body"] for m in ravi.get(f"/channels/{ch}/messages/search", params={"q": "50%"}).json()["messages"]] == \
        ["Grout for the master bath is 50% done"]
    assert ravi.get(f"/channels/{ch}/messages/search", params={"q": "_"}).status_code == 422  # too short
    assert ravi.get(f"/channels/{ch}/messages/search", params={"q": "a_b"}).json()["messages"] == []


def test_search_stays_inside_channels_the_person_can_see(login):
    ravi, nisha, meera = login("ravi@paliath.in"), login("nisha@brightline.events"), login("meera@paliath.in")
    theirs = _general(nisha)["id"]
    _send(nisha, theirs, "Brightline secret venue")
    assert ravi.get(f"/channels/{theirs}/messages/search", params={"q": "secret"}).status_code == 404
    visible = {c["id"] for c in ravi.get("/channels").json()["channels"]}
    private = next(c for c in meera.get("/channels").json()["channels"] if c.get("isPrivate") and c["id"] not in visible)
    assert ravi.get(f"/channels/{private['id']}/messages/search", params={"q": "the"}).status_code == 404
