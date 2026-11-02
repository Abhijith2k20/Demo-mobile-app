"""Siteline Bot (spec §8): who to ask and when, the check-in cards, reminders, escalations and the morning
summary. Tasks come from the saved copy of the PM app's tasks (pm_tasks); answers go back to the PM app
as jobs. Everything timed is a job (jobs/handlers.py), so a restart never loses or repeats one."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from . import db
from .core import now_iso, uuid7
from .events import publish
from .jobs.queue import cancel, enqueue
from .notify import add_activity, push
from .pm import connector as pm
from .rules import OPEN_TASK_STATUSES, pm_change_for, task_needs_update
from .services.messaging import post_message
from .store import BOT_ID, admins, bot_channel_for, company, first_name, project_channel, project_managers, setup, short_project
from .views import checkin_view

RECENTLY_ASKED = "12 hours"
CHECKIN_DEFAULTS = {"workingDays": [0, 1, 2, 3, 4, 5], "morningSummaryAt": "08:30", "checkinAt": "17:30",
                    "reminderAfterMin": 60, "escalateAfterMin": 120}


def settings() -> dict:
    return {**CHECKIN_DEFAULTS, **(setup().get("checkins") or {})}


def zone() -> ZoneInfo:
    return ZoneInfo(company()["timeZone"])


def today() -> date:
    return datetime.now(zone()).date()


def local_time(day: date, hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime.combine(day, time(h, m), tzinfo=zone())


def _post(channel: dict, **kw) -> dict:
    return post_message(channel, BOT_ID, **kw)


# ---- Which tasks need asking ----

def open_tasks_for(user_id: str) -> list[dict]:
    """The person's active or overdue tasks (from the saved copy) in projects that aren't archived, soonest
    finish first."""
    day = today().isoformat()
    tasks = []
    for t in db.rows("""SELECT * FROM pm_tasks WHERE owner_user_id = %(u)s AND removed_at IS NULL
                        AND status = ANY(%(open)s) ORDER BY planned_finish, name""", u=user_id, open=list(OPEN_TASK_STATUSES)):
        task = pm.saved_task(t["pmTaskId"])
        space = pm.project_of(task)
        if task_needs_update(task, day) and not (space and space["archivedAt"]):
            tasks.append(task)
    return tasks


def _recheck(task: dict, user_id: str) -> dict | None:
    """Right before asking, the task as the PM app has it now (§8.1). None when there's nothing to ask any
    more; the saved copy when the PM app doesn't answer in time."""
    from .pm.sync import remove_task, save_task

    try:
        fresh = pm.get_task(task["id"])
    except pm.Unavailable:
        return task
    if not fresh:
        remove_task(task["id"])
        return None
    save_task(fresh)
    fresh = pm.saved_task(task["id"])
    if fresh["ownerUserId"] != user_id or not task_needs_update(fresh, today().isoformat()):
        return None
    space = pm.project_of(fresh)
    return None if space and space["archivedAt"] else fresh


# ---- Cards ----

def create_checkin(user_id: str, task: dict, *, timers: bool) -> dict | None:
    """Asks the owner about one task. With `timers`, a reminder and an escalation follow if unanswered."""
    ch = bot_channel_for(user_id)
    task = _recheck(task, user_id)
    if not ch or not task:
        return None
    cid = uuid7()
    message = _post(ch, type="checkin", body=None, data={"checkinId": cid, "taskId": task["id"]})
    space = pm.project_of(task)
    c = db.insert("checkins", {"id": cid, "companyId": db.company_id(), "taskId": task["id"], "taskName": task["name"],
                               "projectId": space["id"] if space else None, "userId": user_id, "askedAt": now_iso(),
                               "answer": None, "messageId": message["id"], "updatedAt": now_iso()})
    publish({"type": "checkin.new", "checkin": checkin_view(c)}, [user_id])
    if timers:
        s = settings()
        enqueue("remind", {"checkinId": cid}, run_at=_after(s["reminderAfterMin"]), dedupe_key=f"remind:{cid}")
        enqueue("escalate", {"checkinId": cid}, run_at=_after(s["escalateAfterMin"]), dedupe_key=f"escalate:{cid}")
    push([user_id], "Siteline Bot", f"How is {task['name']} going?", {"url": "/dm/bot"}, kind="checkin")
    return c


def _after(minutes: float) -> datetime:
    return datetime.now(zone()) + timedelta(minutes=minutes)


def _checkin(checkin_id: str) -> dict | None:
    return db.row("SELECT * FROM checkins WHERE id = %(id)s", id=checkin_id)


def _closed(c: dict) -> bool:
    return bool(checkin_view(c)["closed"])


def remind(checkin_id: str) -> None:
    c = _checkin(checkin_id)
    if not c or c["answer"] or c["escalatedAt"] or _closed(c):
        return
    ch = bot_channel_for(c["userId"])
    if ch:
        db.update("checkins", {"id": c["id"]}, {"remindedAt": now_iso()})
        _post(ch, type="checkin", body=None, data={"checkinId": c["id"], "taskId": c["taskId"], "reminder": True})
        push([c["userId"]], "Siteline Bot", f"Reminder: {c['taskName']} still needs an update", {"url": "/dm/bot"},
             kind="checkin")


def _report_channel(c: dict) -> dict | None:
    return project_channel(c["projectId"], setup()["workChannel"]) if c["projectId"] else None


def _managers(c: dict) -> list[str]:
    """Who hears about a check-in: the project's Managers, or the company's Admins when it has none."""
    return (project_managers(c["projectId"]) if c["projectId"] else []) or admins()


def escalate(checkin_id: str) -> None:
    c = _checkin(checkin_id)
    if not c or c["answer"] or c["escalatedAt"] or _closed(c):
        return
    cancel(f"remind:{c['id']}")
    db.update("checkins", {"id": c["id"]}, {"escalatedAt": now_iso()})
    ch = _report_channel(c)
    text = f"{first_name(c['userId'])} hasn't updated {c['taskName']}."
    if ch:
        _post(ch, type="status_card", body=None,
              data={"kind": "escalation", "userId": c["userId"], "taskId": c["taskId"], "taskName": c["taskName"], "text": text})
    managers = _managers(c)
    for uid in managers:
        add_activity(userId=uid, kind="escalation", actorId=c["userId"], projectId=c["projectId"],
                     channelId=ch["id"] if ch else None, messageId=None, taskIds=[c["taskId"]], text=text, lines=[])
    push(managers, "No update yet", text, {"url": f"/channel/{ch['id']}" if ch else "/activity"}, kind="escalation")


def send_morning_summary(user_id: str) -> None:
    ch = bot_channel_for(user_id)
    if not ch:
        return
    rows = [{k: t[k] for k in ("id", "name", "plannedFinish", "percent")} for t in open_tasks_for(user_id)[:5]]
    if rows:
        _post(ch, type="text", body=None, data={"kind": "morning_summary", "tasks": rows})
        push([user_id], "Good morning", f"{len(rows)} task{'s' if len(rows) > 1 else ''} today", {"url": "/dm/bot"}, kind="checkin")


def _asked_recently(user_id: str) -> set[str]:
    return {r["taskId"] for r in db.rows(f"""SELECT task_id FROM checkins WHERE user_id = %(u)s
                                             AND asked_at > now() - interval '{RECENTLY_ASKED}'""", u=user_id)}


def send_evening_checkin(user_id: str) -> None:
    """Dev panel: one check-in now, with its reminder and escalation."""
    asked = {r["taskId"] for r in db.rows("SELECT task_id FROM checkins WHERE user_id = %(u)s AND answer IS NULL", u=user_id)}
    for task in open_tasks_for(user_id):
        if task["id"] not in asked and create_checkin(user_id, task, timers=True):
            return
    if ch := bot_channel_for(user_id):
        _post(ch, type="text", body=None, data={"kind": "no_open_tasks"})


def ask_about_open_tasks(user_id: str) -> int:
    """Opening the bot conversation asks about every open task, skipping ones asked in the last 12 hours.
    These cards carry no reminder timer, so a batch can't flood the project channel."""
    ch = bot_channel_for(user_id)
    if not ch:
        return 0
    recent = _asked_recently(user_id)
    asked = sum(1 for t in open_tasks_for(user_id) if t["id"] not in recent and create_checkin(user_id, t, timers=False))
    if not asked and not recent:
        said = db.value("SELECT 1 FROM messages WHERE channel_id = %(c)s AND data->>'kind' = 'no_open_tasks'", c=ch["id"])
        if not said:
            _post(ch, type="text", body=None, data={"kind": "no_open_tasks"})
    return asked


def trigger_escalation(user_id: str) -> bool:
    c = db.row("""SELECT * FROM checkins WHERE user_id = %(u)s AND answer IS NULL AND escalated_at IS NULL
                  ORDER BY asked_at LIMIT 1""", u=user_id)
    if not c:
        return False
    escalate(c["id"])
    return True


# ---- Answers ----

def apply_checkin_answer(c: dict, answer: dict) -> dict:
    """Saves the answer and sends it to the PM app as a job; the status card follows once the PM app accepts
    it (§8.3). "Not started" tells the PM app nothing, so it's reported at once."""
    cancel(f"remind:{c['id']}")
    cancel(f"escalate:{c['id']}")
    change = pm_change_for(answer)
    c = db.update("checkins", {"id": c["id"]}, {"answer": {**answer, "at": now_iso()}, "updatedAt": now_iso(),
                                                "pmWrite": "pending" if change else None})
    if change:
        enqueue("pm_write", {"checkinId": c["id"]}, dedupe_key=f"pmwrite:{c['id']}")
    else:
        report(c)
    publish({"type": "checkin.updated", "checkin": checkin_view(c)}, [c["userId"]])
    return c


def write_answer(checkin_id: str) -> None:
    """The pm_write job. Unavailable is raised again so the job retries; a refusal is final."""
    from .pm.sync import save_task

    c = _checkin(checkin_id)
    if not c or c["pmWrite"] != "pending":
        return
    change = pm_change_for(c["answer"])
    try:
        saved = pm.write_status(c["taskId"], {**change, "note": c["answer"].get("note")}, key=c["id"])
    except pm.Refused as e:
        c = db.update("checkins", {"id": c["id"]}, {"pmWrite": "refused", "pmError": str(e), "updatedAt": now_iso()})
        publish({"type": "checkin.updated", "checkin": checkin_view(c)}, [c["userId"]])
        return
    save_task(saved)  # the saved copy follows the PM app's reply, never the answer
    c = db.update("checkins", {"id": c["id"]}, {"pmWrite": "saved", "pmError": None, "updatedAt": now_iso()})
    report(c)
    publish({"type": "checkin.updated", "checkin": checkin_view(c)}, [c["userId"]])


def write_gave_up(checkin_id: str, pm_name: str = "the PM app") -> None:
    """After a day of retries: the card says so and the Admins hear about it."""
    c = db.update("checkins", {"id": checkin_id}, {"pmWrite": "refused", "pmError": f"Couldn't save to {pm_name}",
                                                   "updatedAt": now_iso()})
    if c:
        publish({"type": "checkin.updated", "checkin": checkin_view(c)}, [c["userId"]])
        for uid in admins():
            add_activity(userId=uid, kind="escalation", actorId=c["userId"], projectId=c["projectId"], channelId=None,
                         messageId=None, taskIds=[c["taskId"]], text=f"{first_name(c['userId'])}'s update on {c['taskName']} "
                         f"couldn't be saved to {pm_name}.", lines=[])


def report(c: dict) -> None:
    """Status card in the project's work channel and Activity for its Managers."""
    answer = c["answer"]
    ch = _report_channel(c)
    if ch:
        _post(ch, type="status_card", body=None,
              data={"kind": "checkin", "userId": c["userId"], "taskId": c["taskId"], "taskName": c["taskName"],
                    "answer": answer, "hasPhoto": bool(answer.get("hasPhoto"))})
    what = {
        "progress": f"to {answer.get('percent')}%",
        "problem": f"— problem: {answer.get('reason') or 'needs attention'}",
        "done": "as done",
        "not_started": "as not started yet",
    }.get(answer["kind"], "as started")
    managers = _managers(c)
    for uid in managers:
        add_activity(userId=uid, kind="checkin_result", actorId=c["userId"], projectId=c["projectId"],
                     channelId=ch["id"] if ch else None, messageId=None, taskIds=[c["taskId"]],
                     text=f"{first_name(c['userId'])} updated {c['taskName']} {what}",
                     lines=[short_project(c["projectId"])] if c["projectId"] else [])
    if answer["kind"] == "problem":
        push(managers, "Problem reported", f"{first_name(c['userId'])}: {c['taskName']} — {answer.get('reason') or 'problem'}",
             {"url": f"/channel/{ch['id']}" if ch else "/activity"}, kind="escalation")


# ---- The day's plan (§8.1; queued by jobs/handlers.plan_day) ----

def evening_checkins(user_id: str) -> int:
    """Asks about each active or overdue task once a day; skips ones already asked today."""
    day = today().isoformat()
    asked_today = {r["taskId"] for r in db.rows("""SELECT task_id FROM checkins WHERE user_id = %(u)s
                                                   AND (asked_at AT TIME ZONE %(tz)s)::date = %(d)s::date""",
                                                u=user_id, tz=company()["timeZone"], d=day)}
    return sum(1 for t in open_tasks_for(user_id)
               if t["id"] not in asked_today and create_checkin(user_id, t, timers=True))
