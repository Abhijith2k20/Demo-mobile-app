"""Siteline Bot (§8): check-ins, reminders, escalation and the morning summary. Tasks come from the PM
app (pm/connector.py); answers go back to it."""
from __future__ import annotations

from .core import now_iso, now_ms, parse_iso_ms, uuid7
from .events import cancel, later, publish
from .notify import add_activity
from .pm import connector as pm
from .rules import pm_change_for, task_needs_update
from .store import S, admins, bot_channel_for, first_name, project_channel, project_managers, setup, short_project
from .views import checkin_view
from .services.messaging import post_message

REMINDER_SECONDS = 60  # demo timing
ESCALATION_SECONDS = 60
RECENTLY_ASKED_MS = 12 * 60 * 60 * 1000

_timers: dict[str, object] = {}


def _post(channel: dict, **kw) -> dict:
    return post_message(channel, S().bot_id, **kw)


def _clear(checkin_id: str) -> None:
    cancel(_timers.pop(checkin_id, None))


def open_tasks_for(user_id: str) -> list[dict]:
    """The person's active or overdue PM tasks in projects that aren't archived, soonest finish first.
    Read live from the PM app, which is the spec's re-check before asking (§8.1) until the saved copy
    of PM tasks arrives with the database."""
    u = S().users.get(user_id)
    if not u:
        return []
    tasks = [t for t in pm.list_tasks(owner_ref=u["email"]) if task_needs_update(t)
             and (p := pm.project_of(t)) and not p["archivedAt"]]
    return sorted(tasks, key=lambda t: t["plannedFinish"])


def _schedule(c: dict) -> None:
    _clear(c["id"])
    if c["answer"] or c["escalatedAt"]:
        return

    def fire(checkin_id: str = c["id"]) -> None:
        current = S().checkins.get(checkin_id)
        if not current or current["answer"]:
            return
        if not current["remindedAt"]:
            remind(current)
        else:
            escalate(current)

    _timers[c["id"]] = later(ESCALATION_SECONDS if c["remindedAt"] else REMINDER_SECONDS, fire)


def remind(c: dict) -> None:
    ch = bot_channel_for(c["userId"])
    if not ch:
        return
    c["remindedAt"] = now_iso()
    _post(ch, type="checkin", body=None, data={"checkinId": c["id"], "taskId": c["taskId"], "reminder": True})
    _schedule(c)


def _report_channel(c: dict) -> dict | None:
    return project_channel(c["projectId"], setup()["workChannel"]) if c["projectId"] else None


def _managers(c: dict) -> list[str]:
    """Who hears about a check-in: the project's Managers, or the company's Admins when it has none."""
    return (project_managers(c["projectId"]) if c["projectId"] else []) or admins()


def escalate(c: dict) -> None:
    if c["escalatedAt"]:
        return
    _clear(c["id"])
    c["escalatedAt"] = now_iso()
    ch = _report_channel(c)
    text = f"{first_name(c['userId'])} hasn't updated {c['taskName']}."
    if ch:
        _post(ch, type="status_card", body=None,
              data={"kind": "escalation", "userId": c["userId"], "taskId": c["taskId"], "taskName": c["taskName"], "text": text})
    for uid in _managers(c):
        add_activity(userId=uid, kind="escalation", actorId=c["userId"], projectId=c["projectId"],
                     channelId=ch["id"] if ch else None, messageId=None, taskIds=[c["taskId"]], text=text, lines=[])


def on_login(user_id: str) -> None:
    """Start reminder clocks for check-ins that were waiting when the user signed in."""
    for c in S().checkins.values():
        if c["userId"] == user_id and not c["answer"] and not c["escalatedAt"] and c["id"] not in _timers:
            _schedule(c)


def send_morning_summary(user_id: str) -> None:
    if ch := bot_channel_for(user_id):
        rows = [{k: t[k] for k in ("id", "name", "plannedFinish", "percent")} for t in open_tasks_for(user_id)[:5]]
        _post(ch, type="text", body=None, data={"kind": "morning_summary", "tasks": rows})


def _create_checkin(user_id: str, task: dict, with_reminder: bool) -> None:
    s = S()
    ch = bot_channel_for(user_id)
    if not ch:
        return
    cid = uuid7()
    message = _post(ch, type="checkin", body=None, data={"checkinId": cid, "taskId": task["id"]})
    ts = now_iso()
    project = pm.project_of(task)
    c = {"id": cid, "taskId": task["id"], "taskName": task["name"], "projectId": project["id"] if project else None,
         "userId": user_id, "askedAt": ts, "answer": None, "messageId": message["id"], "updatedAt": ts,
         "remindedAt": None, "escalatedAt": None, "pmWrite": None, "pmError": None}
    s.checkins[cid] = c
    publish({"type": "checkin.new", "checkin": checkin_view(c)}, [user_id])
    if with_reminder:
        _schedule(c)


def send_evening_checkin(user_id: str) -> None:
    s = S()
    ch = bot_channel_for(user_id)
    if not ch:
        return
    asked = {c["taskId"] for c in s.checkins.values() if c["userId"] == user_id and not c["answer"]}
    task = next((t for t in open_tasks_for(user_id) if t["id"] not in asked), None)
    if not task:
        _post(ch, type="text", body=None, data={"kind": "no_open_tasks"})
        return
    _create_checkin(user_id, task, True)


def ask_about_open_tasks(user_id: str) -> int:
    """Opening the bot conversation asks about every open task, skipping ones asked in the last
    12 hours. These cards carry no reminder timer, so a batch can't flood the project channel."""
    s = S()
    ch = bot_channel_for(user_id)
    if not ch:
        return 0
    cutoff = now_ms() - RECENTLY_ASKED_MS
    recent = {c["taskId"] for c in s.checkins.values() if c["userId"] == user_id and parse_iso_ms(c["askedAt"]) > cutoff}
    tasks = [t for t in open_tasks_for(user_id) if t["id"] not in recent]
    if not tasks:
        said = any(m["channelId"] == ch["id"] and (m["data"] or {}).get("kind") == "no_open_tasks" for m in s.messages.values())
        if not recent and not said:
            _post(ch, type="text", body=None, data={"kind": "no_open_tasks"})
        return 0
    for t in tasks:
        _create_checkin(user_id, t, False)
    return len(tasks)


def trigger_escalation(user_id: str) -> bool:
    c = next((x for x in S().checkins.values() if x["userId"] == user_id and not x["answer"] and not x["escalatedAt"]), None)
    if not c:
        return False
    escalate(c)
    return True


def apply_checkin_answer(c: dict, answer: dict) -> None:
    """Sends the answer to the PM app, then (once it's saved) a status card in the project and
    activity for the managers. A refusal is kept on the check-in and shown on the card."""
    _clear(c["id"])
    c["answer"] = {**answer, "at": now_iso()}
    c["updatedAt"] = now_iso()
    change = pm_change_for(answer)
    if change:
        try:
            pm.write_status(c["taskId"], {**change, "note": answer.get("note")}, key=c["id"])
            c["pmWrite"] = "saved"
        except pm.Refused as e:
            c["pmWrite"], c["pmError"] = "refused", str(e)
    if c["pmWrite"] != "refused":
        _report(c, answer)
    publish({"type": "checkin.new", "checkin": checkin_view(c)}, [c["userId"]])


def _report(c: dict, answer: dict) -> None:
    ch = _report_channel(c)
    if ch:
        _post(ch, type="status_card", body=None,
              data={"kind": "checkin", "userId": c["userId"], "taskId": c["taskId"], "taskName": c["taskName"],
                    "answer": c["answer"], "hasPhoto": bool(answer.get("hasPhoto"))})
    what = {
        "progress": f"to {answer.get('percent')}%",
        "problem": f"— problem: {answer.get('reason') or 'needs attention'}",
        "done": "as done",
        "not_started": "as not started yet",
    }.get(answer["kind"], "as started")
    for uid in _managers(c):
        add_activity(userId=uid, kind="checkin_result", actorId=c["userId"], projectId=c["projectId"],
                     channelId=ch["id"] if ch else None, messageId=None, taskIds=[c["taskId"]],
                     text=f"{first_name(c['userId'])} updated {c['taskName']} {what}",
                     lines=[short_project(c["projectId"])] if c["projectId"] else [])


def reset_bot() -> None:
    for h in list(_timers.values()):
        cancel(h)
    _timers.clear()
