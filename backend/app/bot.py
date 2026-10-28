"""Siteline Bot (§8): check-ins, reminders, escalation and the morning summary."""
from __future__ import annotations

from .core import now_iso, now_ms, parse_iso_ms, uuid7
from .events import cancel, later, publish
from .notify import add_activity
from .rules import is_company_admin, is_done
from .store import S, bot_channel_for, first_name, project_channel, project_managers, setup, short_project
from .views import checkin_view
from .services.messaging import post_message
from .services.tasks import apply_task_changes

REMINDER_SECONDS = 60  # demo timing
ESCALATION_SECONDS = 60
RECENTLY_ASKED_MS = 12 * 60 * 60 * 1000

_timers: dict[str, object] = {}


def _post(channel: dict, **kw) -> dict:
    return post_message(channel, S().bot_id, **kw)


def _clear(checkin_id: str) -> None:
    cancel(_timers.pop(checkin_id, None))


def open_tasks_for(user_id: str) -> list[dict]:
    s = S()
    tasks = [t for t in s.tasks.values() if t["ownerId"] == user_id and not t["deletedAt"] and not is_done(t["status"])
             and not s.projects.get(t["projectId"], {}).get("archivedAt")]
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


def _report_channel(task: dict) -> dict | None:
    s = S()
    return (s.channels.get(task["channelId"]) if task["channelId"] else None) or project_channel(task["projectId"], setup()["workChannel"])


def escalate(c: dict) -> None:
    s = S()
    task = s.tasks.get(c["taskId"])
    if not task or c["escalatedAt"]:
        return
    _clear(c["id"])
    c["escalatedAt"] = now_iso()
    ch = _report_channel(task)
    text = f"{first_name(c['userId'])} hasn't updated {task['name']}."
    if ch:
        _post(ch, type="status_card", body=None,
              data={"kind": "escalation", "userId": c["userId"], "taskId": task["id"], "taskName": task["name"], "text": text})
    for uid in project_managers(task["projectId"]):
        add_activity(userId=uid, kind="escalation", actorId=c["userId"], projectId=task["projectId"],
                     channelId=ch["id"] if ch else None, messageId=None, taskIds=[task["id"]], text=text, lines=[])


def on_login(user_id: str) -> None:
    """Start reminder clocks for check-ins that were waiting when the user signed in."""
    for c in S().checkins.values():
        if c["userId"] == user_id and not c["answer"] and not c["escalatedAt"] and c["id"] not in _timers:
            _schedule(c)


def send_morning_summary(user_id: str) -> None:
    if ch := bot_channel_for(user_id):
        _post(ch, type="text", body=None,
              data={"kind": "morning_summary", "taskIds": [t["id"] for t in open_tasks_for(user_id)[:5]]})


def _create_checkin(user_id: str, task: dict, with_reminder: bool) -> None:
    s = S()
    ch = bot_channel_for(user_id)
    if not ch:
        return
    cid = uuid7()
    message = _post(ch, type="checkin", body=None, data={"checkinId": cid, "taskId": task["id"]})
    ts = now_iso()
    c = {"id": cid, "taskId": task["id"], "userId": user_id, "askedAt": ts, "answer": None, "messageId": message["id"],
         "updatedAt": ts, "remindedAt": None, "escalatedAt": None}
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
    """Task update ("via check-in" history), status card in the project, activity for managers."""
    s = S()
    _clear(c["id"])
    c["answer"] = {**answer, "at": now_iso()}
    c["updatedAt"] = now_iso()
    task = s.tasks.get(c["taskId"])
    if not task:
        return
    who = s.users.get(c["userId"])
    is_manager = c["userId"] in project_managers(task["projectId"]) or bool(who and is_company_admin(who))
    kind = answer["kind"]
    change = {
        "progress": {"percent": answer.get("percent") if answer.get("percent") is not None else task["percent"], "status": "in_progress"},
        "started": {"status": "in_progress"},
        "problem": {"status": "blocked"},
        "done": {"status": "done"},
    }.get(kind)
    if change:
        apply_task_changes(c["userId"], task, change, "checkin", is_manager)
    ch = _report_channel(task)
    if ch:
        _post(ch, type="status_card", body=None,
              data={"kind": "checkin", "userId": c["userId"], "taskId": task["id"], "taskName": task["name"],
                    "answer": c["answer"], "hasPhoto": bool(answer.get("hasPhoto"))})
    what = {
        "progress": f"to {answer.get('percent')}%",
        "problem": f"— problem: {answer.get('reason') or 'needs attention'}",
        "done": "as done",
        "not_started": "as not started yet",
    }.get(kind, "as started")
    for uid in project_managers(task["projectId"]):
        add_activity(userId=uid, kind="checkin_result", actorId=c["userId"], projectId=task["projectId"],
                     channelId=ch["id"] if ch else None, messageId=None, taskIds=[task["id"]],
                     text=f"{first_name(c['userId'])} updated {task['name']} {what}", lines=[short_project(task["projectId"])])
    publish({"type": "checkin.new", "checkin": checkin_view(c)}, [c["userId"]])


def reset_bot() -> None:
    for h in list(_timers.values()):
        cancel(h)
    _timers.clear()
