"""Cards from the PM app (spec §8, docs/CARDS_API.md). Siteline decides nothing about them: it shows the card in
the person's Siteline Bot conversation, checks the answer against what the card offered, and queues the answer
for the PM app. Both the Cards API and the mock PM app go through these functions."""
from __future__ import annotations

from .. import db
from ..core import ApiError, invalid, not_found, now_iso, uuid7
from ..events import publish
from ..jobs.queue import enqueue
from ..notify import push
from ..store import BOT_ID, bot_channel_for
from . import files
from .messaging import post_message

ANSWER_PARTS = ("scale", "scaleReached", "buttons", "note")
CONTENT_KEYS = ("title", "subtitle", "badge", "fields", *ANSWER_PARTS, "push")


def person_for_ref(ref: str) -> dict:
    """The active member of this company the PM app means (by work email, any case); refused otherwise."""
    ident = (ref or "").strip().lower()
    uid = db.value("""SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id AND m.company_id = current_company()
                      WHERE m.status = 'active' AND u.deleted_at IS NULL AND u.email = %(r)s""", r=ident)
    if not uid:
        raise ApiError("NOT_A_MEMBER", f"{ref} isn't in this company on Siteline.", {"fields": {"to": "Not in this company"}})
    return {"id": uid, "ref": ident}


def _row(card_id: str) -> dict | None:
    return db.row("SELECT * FROM cards WHERE id = %(id)s", id=card_id)


def by_ext_id(ext_id: str) -> dict | None:
    return db.row("SELECT * FROM cards WHERE ext_id = %(e)s", e=ext_id)


def state(c: dict) -> str:
    """open, answered, closed or expired (an open card past its expiry)."""
    if c["state"] == "open" and c["expiresAt"] and c["expiresAt"] <= now_iso():
        return "expired"
    return c["state"]


def card_view(c: dict) -> dict:
    """What the app draws (and the PM app reads back with GET /cards/{id})."""
    return {
        "id": c["id"], "extId": c["extId"], "userId": c["userId"], "content": c["content"], "state": state(c),
        "closedText": c["closedText"], "answer": c["answer"], "answeredAt": c["answeredAt"], "seenAt": c["seenAt"],
        "nudgedAt": c["nudgedAt"], "delivery": c["delivery"], "deliveryError": c["deliveryError"],
        "expiresAt": c["expiresAt"], "askedAt": c["createdAt"],
    }


def _publish(c: dict, kind: str = "card.updated") -> None:
    publish({"type": kind, "card": card_view(c)}, [c["userId"]])


# ---- From the PM app ----

def create(*, ext_id: str, to: str, content: dict, ref: dict | None = None,
           expires_at: str | None = None) -> tuple[dict, bool]:
    """Sends a card to one person. The same `ext_id` again returns the first card (no second card or push).
    Returns (card, created)."""
    if existing := by_ext_id(ext_id):
        return existing, False
    person = person_for_ref(to)
    ch = bot_channel_for(person["id"])
    if not ch:
        raise ApiError("NOT_A_MEMBER", f"{to} has no Siteline Bot conversation.")
    cid = uuid7()
    # The card first: a repeat sent at the same moment waits on the unique id and then gets this card back,
    # instead of an error (and nothing is posted twice).
    c = db.insert("cards", {"id": cid, "companyId": db.company_id(), "extId": ext_id, "userId": person["id"],
                            "content": {k: content[k] for k in CONTENT_KEYS if content.get(k) is not None},
                            "ref": ref or {}, "expiresAt": expires_at}, on_conflict_nothing=True)
    if not c:
        return by_ext_id(ext_id), False
    message = post_message(ch, BOT_ID, type="card", body=None, data={"cardId": cid})
    c = db.update("cards", {"id": cid}, {"messageId": message["id"]})
    _publish(c, "card.new")
    note = content.get("push") or {}
    push([person["id"]], note.get("title") or "Siteline Bot", note.get("body") or content["title"], {"url": "/dm/bot"},
         kind="card", channel_id=ch["id"])
    return c, True


def _open(ext_id: str) -> dict:
    c = by_ext_id(ext_id)
    if not c:
        raise not_found("Card")
    if state(c) != "open":
        raise ApiError("CARD_CLOSED", "This card can't be changed any more: it was answered, closed or expired.")
    return c


def update(ext_id: str, changes: dict) -> dict:
    """Changes an open card's content, or closes it; the person's phone refreshes it at once."""
    c = _open(ext_id)
    fields: dict = {"updatedAt": now_iso()}
    content = {**c["content"], **{k: v for k, v in changes.items() if k in CONTENT_KEYS}}
    fields["content"] = {k: v for k, v in content.items() if v is not None}
    if "expiresAt" in changes:
        fields["expiresAt"] = changes["expiresAt"]
    if changes.get("closed"):
        fields.update(state="closed", closedText=changes.get("closedText") or "Closed")
    c = db.update("cards", {"id": c["id"]}, fields)
    _publish(c)
    return c


def nudge(ext_id: str) -> dict:
    """A quiet reminder line under the conversation and a push; at most once an hour per card."""
    c = _open(ext_id)
    if c["nudgedAt"] and db.value("SELECT %(t)s::timestamptz > now() - interval '1 hour'", t=c["nudgedAt"]):
        raise ApiError("RATE_LIMITED", "This card was nudged in the last hour.")
    c = db.update("cards", {"id": c["id"]}, {"nudgedAt": now_iso(), "updatedAt": now_iso()})
    ch = bot_channel_for(c["userId"])
    if ch:
        post_message(ch, BOT_ID, type="card", body=None, data={"cardId": c["id"], "nudge": True})
    push([c["userId"]], "Siteline Bot", f"Reminder: {c['content']['title']} still needs an answer", {"url": "/dm/bot"},
         kind="card", channel_id=ch["id"] if ch else None)
    _publish(c)
    return c


# ---- From the person ----

def _check_answer(content: dict, a: dict) -> None:
    """The answer must be one of the things the card offered."""
    scale = {s["id"] for s in content.get("scale") or []}
    buttons = {b["id"]: b for b in content.get("buttons") or []}
    note_rules = content.get("note") or {}
    if bool(a.get("scale")) == bool(a.get("button")):
        raise invalid({"answer": "Pick one answer"})
    needs_note = False
    if a.get("scale"):
        if a["scale"] not in scale:
            raise invalid({"answer": "Not one of this card's answers"})
    else:
        b = buttons.get(a["button"])
        if not b:
            raise invalid({"answer": "Not one of this card's answers"})
        choices = {ch["id"]: ch for ch in b.get("choices") or []}
        if choices:
            if a.get("choice") not in choices:
                raise invalid({"choice": "Pick one of the choices"})
            needs_note = bool(choices[a["choice"]].get("noteRequired"))
        elif a.get("choice"):
            raise invalid({"choice": "This answer has no choices"})
        needs_note = needs_note or bool(b.get("noteRequired"))
    if needs_note and not (a.get("note") or "").strip():
        raise invalid({"note": "Add a note"})
    if a.get("note") and not note_rules.get("text") and not needs_note:
        raise invalid({"note": "This card takes no note"})
    if a.get("voiceUploadId") and not note_rules.get("voice"):
        raise invalid({"voice": "This card takes no voice note"})
    if a.get("photoUploadIds") and not note_rules.get("photo"):
        raise invalid({"photos": "This card takes no photos"})


def card_for(user: dict, card_id: str) -> dict:
    c = _row(card_id)
    if not c or c["userId"] != user["id"]:
        raise not_found("Card")
    return c


def answer(user: dict, card_id: str, a: dict) -> dict:
    """Saves the person's answer once (repeating it changes nothing) and queues it for the PM app."""
    c = card_for(user, card_id)
    if c["state"] == "answered":
        return c
    if state(c) != "open":
        raise ApiError("CARD_CLOSED", "This card can't be answered any more.")
    _check_answer(c["content"], a)
    for upload_id in [a.get("voiceUploadId"), *(a.get("photoUploadIds") or [])]:
        if upload_id and not db.value("SELECT 1 FROM uploads WHERE id = %(id)s AND user_id = %(u)s", id=upload_id, u=user["id"]):
            raise invalid({"note": "Upload not found"})
    files.mark_attached([a.get("voiceUploadId"), *(a.get("photoUploadIds") or [])])
    answered_at = a.pop("answeredAt", None) or now_iso()
    c = db.update("cards", {"id": c["id"]}, {
        "state": "answered", "answer": {k: v for k, v in a.items() if v not in (None, "", [])},
        "answeredAt": answered_at, "receivedAt": now_iso(), "delivery": "pending", "updatedAt": now_iso()})
    enqueue("webhook", {"event": "card.answered", "cardId": c["id"]}, dedupe_key=f"webhook:card.answered:{c['id']}")
    _publish(c)
    return c


def mark_seen(user: dict, card_id: str) -> None:
    """The first time the person opens the card; the PM app hears about it if the company turned card.seen on."""
    from .integrations import send_card_seen

    c = card_for(user, card_id)
    if not c["seenAt"]:
        send_card_seen(db.update("cards", {"id": c["id"]}, {"seenAt": now_iso()}))


def set_delivery(card_id: str, delivery: str, error: str | None = None) -> None:
    c = db.update("cards", {"id": card_id}, {"delivery": delivery, "deliveryError": error, "updatedAt": now_iso()})
    if c:
        _publish(c)
