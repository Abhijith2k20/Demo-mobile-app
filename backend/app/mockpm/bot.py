"""The mock PM app's chasing (what a real PM app does on its side, docs/CARDS_API.md §6): which tasks to ask
about and when, check-in cards, reminders, escalations, morning summaries, and what an answer means for the
task. It talks to Siteline only through the Cards API functions (the same ones the HTTP API calls) and gets
answers through the same webhook delivery, so it behaves like a real PM app."""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .. import db
from ..core import ApiError
from ..jobs.queue import enqueue
from ..services import cards, integrations
from ..services import projects as spaces
from ..store import company, setup
from . import data
from .data import OPEN, Refused

SETTINGS = {"workingDays": [0, 1, 2, 3, 4, 5], "morningSummaryAt": "08:30", "checkinAt": "17:30",
            "reminderAfterMin": 60, "escalateAfterMin": 120}
SCALE = [{"id": "25", "label": "25%"}, {"id": "50", "label": "50%"}, {"id": "75", "label": "75%"},
         {"id": "90", "label": "90%"}, {"id": "done", "label": "Done"}]


def zone() -> ZoneInfo:
    return ZoneInfo(company()["timeZone"])


def today() -> date:
    return datetime.now(zone()).date()


def local_time(day: date, hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime.combine(day, time(h, m), tzinfo=zone())


def _after(minutes: float) -> datetime:
    return datetime.now(zone()) + timedelta(minutes=minutes)


# ---- Which tasks need asking ----

def needs_update(task: dict, day: str) -> bool:
    """Started (or overdue) and not done: the mock asks about these."""
    return task["status"] in OPEN and task["plannedStart"] <= day


def _row(task_id: str) -> dict | None:
    return db.row("""SELECT t.*, p.name AS project_name, p.status AS project_status FROM pm_mock_tasks t
                     JOIN pm_mock_projects p ON p.id = t.project_id WHERE t.id = %(id)s AND t.deleted_at IS NULL""", id=task_id)


def open_tasks_for(ref: str) -> list[dict]:
    day = today().isoformat()
    rows = db.rows("""SELECT t.*, p.name AS project_name, p.status AS project_status FROM pm_mock_tasks t
                      JOIN pm_mock_projects p ON p.id = t.project_id
                      WHERE t.deleted_at IS NULL AND lower(t.owner_ref) = lower(%(r)s) AND p.status = 'active'
                      ORDER BY t.planned_finish, t.name""", r=ref)
    return [t for t in rows if needs_update(t, day)]


def owners() -> list[str]:
    return [r["ownerRef"] for r in db.rows("""SELECT DISTINCT t.owner_ref FROM pm_mock_tasks t
                                             JOIN pm_mock_projects p ON p.id = t.project_id
                                             WHERE t.deleted_at IS NULL AND t.owner_ref IS NOT NULL AND p.status = 'active'
                                               AND t.status IN ('not_started', 'in_progress', 'blocked')""")]


def ref_of(user_id: str) -> str | None:
    """The dev panel names a Siteline person; the mock knows people by email or phone."""
    u = db.row("SELECT email, phone FROM users WHERE id = %(u)s", u=user_id)
    return (u["email"] or u["phone"]) if u else None


# ---- Card content ----

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40] or "other"


def _due(t: dict) -> str:
    return datetime.fromisoformat(str(t["plannedFinish"])).strftime("%a %-d %b")


def checkin_content(t: dict) -> dict:
    overdue = str(t["plannedFinish"]) < today().isoformat()
    reached = next((s["id"] for s in reversed(SCALE[:-1]) if int(s["id"]) <= (t["percent"] or 0)), None)
    problems = [{"id": _slug(p["key"]), "label": p["key"]} for p in setup().get("problemTypes") or []
                if p.get("inCheckins", True)]
    return {
        "title": t["name"],
        "subtitle": f"{t['projectName']} · due {_due(t)}",
        "badge": {"text": "Overdue", "tone": "danger"} if overdue else None,
        "fields": [{"label": "Now", "value": f"{t['percent'] or 0}%"}],
        "scale": SCALE,
        "scaleReached": reached,
        "buttons": [{"id": "problem", "label": "Problem",
                     "choices": problems + [{"id": "other", "label": "Other", "noteRequired": True}]},
                    {"id": "not_started", "label": "Not started"}],
        "note": {"text": True, "voice": True, "photo": True},
        "push": {"title": "Siteline Bot", "body": f"How is {t['name']} going?"},
    }


# ---- Sending ----

def ask(t: dict, *, timers: bool) -> dict | None:
    """One check-in card for a task (one per task per day). With `timers`, a reminder and an escalation follow."""
    card_id = f"checkin-{t['id']}-{today().isoformat()}"
    try:
        card, created = cards.create(ext_id=card_id, to=t["ownerRef"], project_ref=t["projectId"],
                                     content=checkin_content(t), ref={"task": t["id"]})
    except ApiError:  # the owner isn't on Siteline (yet), or the project isn't published
        return None
    if created:
        db.insert("pm_mock_cards", {"companyId": db.company_id(), "cardId": card_id, "taskId": t["id"], "kind": "checkin",
                                    "sentOn": today().isoformat()})
        if timers:
            enqueue("mock_remind", {"card": card_id}, run_at=_after(SETTINGS["reminderAfterMin"]), dedupe_key=f"mock_remind:{card_id}")
            enqueue("mock_escalate", {"card": card_id}, run_at=_after(SETTINGS["escalateAfterMin"]),
                    dedupe_key=f"mock_escalate:{card_id}")
    return card if created else None


def evening_checkins(ref: str) -> int:
    return sum(1 for t in open_tasks_for(ref) if ask(t, timers=True))


def checkin_now(ref: str) -> bool:
    """Dev panel: the next task not asked today, with its reminder and escalation."""
    return any(ask(t, timers=True) for t in open_tasks_for(ref))


def morning_summary(ref: str) -> None:
    rows = open_tasks_for(ref)[:5]
    if not rows:
        return
    try:
        cards.create(ext_id=f"summary-{_slug(ref)}-{today().isoformat()}", to=ref, content={
            "title": "Good morning", "subtitle": f"{len(rows)} task{'s' if len(rows) > 1 else ''} today",
            "fields": [{"label": t["name"][:40], "value": f"{t['percent'] or 0}% · due {_due(t)}"} for t in rows],
            "push": {"title": "Good morning", "body": f"{len(rows)} task{'s' if len(rows) > 1 else ''} today"}})
    except ApiError:
        pass


def _open_card(card_id: str) -> dict | None:
    c = cards.by_ext_id(card_id)
    return c if c and cards.state(c) == "open" else None


def remind(card_id: str) -> None:
    if _open_card(card_id):
        try:
            cards.nudge(card_id)
        except ApiError:
            pass


def escalate(card_id: str) -> bool:
    c = _open_card(card_id)
    task_id = db.value("SELECT task_id FROM pm_mock_cards WHERE card_id = %(c)s", c=card_id)
    t = _row(task_id) if task_id else None
    if not c or not t:
        return False
    who = db.value("SELECT name FROM users WHERE id = %(u)s", u=c["userId"]).split(" ")[0]
    text = f"{who} hasn't updated {t['name']}."
    integrations.post_channel_message(ext_id=f"escalate-{card_id}", project_ref=t["projectId"], channel=None,
                                      card={"title": text, "lines": [f"Due {_due(t)} · {t['percent'] or 0}%"], "tone": "warning"},
                                      notify={"managers": True, "push": text})
    return True


def escalate_first(ref: str) -> bool:
    """Dev panel: escalate this person's oldest open check-in now."""
    for r in db.rows("""SELECT c.card_id FROM pm_mock_cards c JOIN pm_mock_tasks t ON t.id = c.task_id
                        WHERE c.kind = 'checkin' AND lower(t.owner_ref) = lower(%(r)s) ORDER BY c.sent_on, c.card_id""", r=ref):
        if escalate(r["cardId"]):
            return True
    return False


def plan_day(p: dict) -> None:
    """Queues today's summaries and check-ins, then itself for the next midnight."""
    day, now = today(), datetime.now(zone())
    if day.weekday() in SETTINGS["workingDays"]:
        for ref in owners():
            for kind, at in (("mock_summary", SETTINGS["morningSummaryAt"]), ("mock_checkins", SETTINGS["checkinAt"])):
                run_at = local_time(day, at)
                if run_at > now:  # a company created at 14:00 doesn't get a late morning summary
                    enqueue(kind, {"ref": ref}, run_at=run_at, dedupe_key=f"{kind}:{db.company_id()}:{ref}:{day}")
    nxt = local_time(day + timedelta(days=1), "00:01")
    enqueue("mock_plan_day", {}, run_at=nxt, dedupe_key=f"mock_plan_day:{db.company_id()}:{nxt.date()}")


# ---- Answers (the card.answered webhook) ----

def change_for(answer: dict) -> dict | None:
    """What an answer means for the task. "Not started" changes nothing."""
    if answer.get("scale"):
        return {"status": "done"} if answer["scale"] == "done" else {"status": "in_progress", "percent": int(answer["scale"])}
    if answer.get("button") == "problem":
        return {"status": "blocked"}
    return None


def receive(event: str, body: dict) -> dict:
    """The mock's webhook endpoint. Raises Unavailable while "down", so Siteline retries."""
    data._check_up()
    if event in ("person.joined", "person.left"):
        publish_projects()
        return {"result": "accepted"}
    if event != "card.answered":
        return {"result": "accepted"}
    task_id = (body.get("ref") or {}).get("task")
    if not task_id:
        return {"result": "accepted"}  # an information card
    change = change_for(body["answer"])
    try:
        if change:
            data.write_status(task_id, change, key=body["card"])
    except Refused as e:
        return {"result": "refused", "message": str(e)}
    t = _row(task_id)
    if t:
        _status_card(t, body)
    return {"result": "accepted"}


def _status_card(t: dict, body: dict) -> None:
    a, note = body["answer"], body.get("note") or {}
    who = db.value("""SELECT u.name FROM users u WHERE lower(u.email) = lower(%(r)s) OR u.phone = %(r)s""", r=body["person"])
    first = (who or body["person"]).split(" ")[0]
    if a.get("scale"):
        what, tone = ("done", "success") if a["scale"] == "done" else (f"→ {a['scale']}%", "info")
    elif a.get("button") == "problem":
        label = next((p["key"] for p in setup().get("problemTypes") or [] if _slug(p["key"]) == a.get("choice")), "Other")
        what, tone = f"— problem: {label}", "danger"
    else:
        what, tone = "not started yet", "warning"
    title = f"{first} · {t['name']} {what}"
    lines = [f"“{note['text']}”"] if note.get("text") else []
    photos = [p["upload"] for p in note.get("photos") or []]
    integrations.post_channel_message(
        ext_id=f"status-{body['card']}", project_ref=t["projectId"], channel=None,
        card={"title": title[:200], "lines": lines, "tone": tone, "photos": photos},
        notify={"managers": True, "push": f"{first}: {t['name']} {what}" if tone == "danger" else None})


# ---- Changes in the mock (platform panel, dev panel) ----

def task_changed(task_id: str) -> None:
    """Open check-in cards follow the task: refreshed, or closed when it's done, removed or reassigned."""
    t = _row(task_id)
    for r in db.rows("SELECT card_id FROM pm_mock_cards WHERE task_id = %(t)s AND kind = 'checkin'", t=task_id):
        c = _open_card(r["cardId"])
        if not c:
            continue
        if not t or t["status"] not in OPEN or t["projectStatus"] != "active" or _owner_id(t) != c["userId"]:
            cards.update(r["cardId"], {"closed": True, "closedText": "Changed in the PM app"})
        else:
            content = checkin_content(t)
            cards.update(r["cardId"], {k: content[k] for k in ("title", "subtitle", "badge", "fields", "scaleReached")})


def _owner_id(t: dict) -> str | None:
    try:
        return cards.person_for_ref(t["ownerRef"])["id"]
    except ApiError:
        return None


def publish_projects() -> None:
    """Sends every mock project and its members to Siteline (PUT /projects/{ref})."""
    for p in db.rows("SELECT * FROM pm_mock_projects ORDER BY name"):
        members = db.rows("SELECT person_ref AS ref, name, role, role_name FROM pm_mock_members WHERE project_id = %(p)s",
                          p=p["id"])
        _, unmatched = spaces.apply_pm_project(p["id"], {"name": p["name"], "client": p["client"] or "",
                                                         "address": p["address"] or "", "url": p["url"],
                                                         "status": p["status"], "members": members})
        integrations.remember_unmatched(p["id"], unmatched)
        for r in db.rows("SELECT id FROM pm_mock_tasks WHERE project_id = %(p)s AND deleted_at IS NULL", p=p["id"]):
            task_changed(r["id"])
