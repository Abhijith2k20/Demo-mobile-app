"""Business rules. The server is the only place they live: the app just shows the results."""
from __future__ import annotations

from datetime import date, datetime, timedelta

# ---- Permissions (spec §9) ----

PROJECT_PERMISSIONS: dict[str, list[str]] = {
    "manager": [
        "project.edit",
        "project.stage",
        "project.members",
        "channel.manage",
        "task.create",
        "task.edit_any",
        "task.update_for_others",
        "task.confirm",
        "task.baseline",
        "message.delete_any",
        "message.pin",
    ],
    "member": ["task.create", "task.update_own"],
}
ALL_PROJECT_ACTIONS = sorted({a for acts in PROJECT_PERMISSIONS.values() for a in acts})

EDIT_WINDOW_MS = 15 * 60 * 1000
DELETE_WINDOW_MS = 60 * 60 * 1000
MEMBER_EDITABLE = {"status", "percent"}
PERCENT_STEPS = [0, 25, 50, 75, 90, 100]
HOME_CHANNEL = "general"
LANGUAGES = ("en", "kn", "hi")
ROLES_IN_EVERY_CHANNEL = ["manager"]  # §9.3: managers are in every channel of their project


def is_company_admin(user: dict) -> bool:
    return user["companyRole"] in ("owner", "admin")


def joins_projects(user: dict) -> bool:
    """Owner and Admins already see every project, so they are never added as project members."""
    return not is_company_admin(user)


def can(user: dict, action: str, project_role: str | None) -> bool:
    if is_company_admin(user):
        return True
    return bool(project_role) and action in PROJECT_PERMISSIONS[project_role]


def project_permissions(user: dict, project_role: str | None, archived: bool) -> list[str]:
    """What the user may do in a project right now. An archived project is read-only."""
    allowed = [a for a in ALL_PROJECT_ACTIONS if can(user, a, project_role)]
    lifecycle = (["project.archive"] if "project.edit" in allowed else []) + (["project.delete"] if is_company_admin(user) else [])
    # Archived: read-only, but it can still be unarchived or deleted.
    return lifecycle if archived else allowed + lifecycle


def company_permissions(user: dict) -> list[str]:
    perms = []
    if is_company_admin(user):
        perms += ["company.users", "project.create", "user.invite"]
    if user["companyRole"] == "owner":
        perms.append("user.invite_admin")
    return perms


def can_invite_as(user: dict, role: str) -> bool:
    return user["companyRole"] == "owner" if role == "admin" else is_company_admin(user)


def can_deactivate(actor: dict, target: dict) -> bool:
    """Nobody deactivates themselves or the Owner; an Admin can deactivate Members only."""
    if actor["id"] == target["id"] or target["companyRole"] == "owner":
        return False
    if actor["companyRole"] == "owner":
        return True
    return actor["companyRole"] == "admin" and target["companyRole"] == "member"


def can_post(user: dict, channel: dict) -> bool:
    if channel["kind"] == "bot":
        return False
    if channel["postingPolicy"] == "admins":
        return is_company_admin(user)
    return True


# ---- The company's own setup (stages, phases, job titles, channels; see seed.py) ----
# Nothing below knows an industry: each company's words and defaults are data.

def localized(label: dict | str, lang: str) -> str:
    """A setup label in the reader's language, falling back to English."""
    return label if isinstance(label, str) else label.get(lang) or label["en"]


def stage_keys(setup: dict) -> list[str]:
    return [st["key"] for st in setup["stages"]]


def next_stage(setup: dict, stage: str) -> str | None:
    keys = stage_keys(setup)
    i = keys.index(stage) if stage in keys else -1
    return keys[i + 1] if 0 <= i < len(keys) - 1 else None


def job_title_info(setup: dict, name: str) -> dict | None:
    return next((jt for jt in setup["jobTitles"] if jt["name"] == name), None)


def job_title_error(setup: dict, role: str, name: str) -> str | None:
    """Why this job title can't be used for this project role, or None if it can."""
    jt = job_title_info(setup, name)
    if not jt:
        return "Pick one of the company's job titles"
    if jt.get("managersOnly") and role != "manager":
        return "This job title is for managers"
    return None


def default_channel_names(setup: dict, role: str, job_title: str) -> list[str]:
    """§9.3 — channels a new project member joins by default."""
    if role in ROLES_IN_EVERY_CHANNEL:
        return [c["name"] for c in setup["projectChannels"]]
    jt = job_title_info(setup, job_title)
    return list(jt["channels"]) if jt else [HOME_CHANNEL]


def simple_mode(setup: dict, job_titles: list[str]) -> bool:
    """Big-button layout when every project role the person has is marked simple."""
    return bool(job_titles) and all((job_title_info(setup, jt) or {}).get("simpleMode", False) for jt in job_titles)


def channel_rank(setup: dict, channel: dict) -> tuple:
    """The company's standard project channels first, in setup order, then the rest by name."""
    names = [c["name"] for c in setup["projectChannels"]]
    return (names.index(channel["name"]) if channel["name"] in names else len(names), channel["name"])


# ---- Dates ----

def today_iso() -> str:
    return date.today().isoformat()


def add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def days_between(later: str, earlier: str) -> int:
    return (date.fromisoformat(later) - date.fromisoformat(earlier)).days


def short_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b')}"


# ---- Tasks ----

def is_done(status: str) -> bool:
    return status in ("done", "done_pending_confirmation")


def normalize_task_change(task: dict, changes: dict, is_manager: bool, today: str | None = None) -> dict:
    """Fills in the consequences of a change: percent ↔ status, Members' "done" waiting for a
    Manager, and actual start/finish dates. No-ops are dropped."""
    today = today or today_iso()
    nxt = dict(changes)
    if "percent" in nxt and "status" not in nxt:
        if nxt["percent"] >= 100:
            nxt["status"] = "done"
        elif nxt["percent"] > 0 and task["status"] == "not_started":
            nxt["status"] = "in_progress"
        elif nxt["percent"] < 100 and is_done(task["status"]):
            nxt["status"] = "in_progress"
    if nxt.get("status") == "done" and not is_manager:
        nxt["status"] = "done_pending_confirmation"
    if "status" in nxt:
        status = nxt["status"]
        if is_done(status):
            nxt["percent"] = 100
        elif is_done(task["status"]) and "percent" not in nxt:
            nxt["percent"] = 90
        if status == "not_started" and "percent" not in nxt:
            nxt["percent"] = 0
        if status != "not_started" and not task["actualStart"]:
            nxt["actualStart"] = today
        if status == "not_started":
            nxt["actualStart"] = None
        nxt["actualFinish"] = (task["actualFinish"] or today) if is_done(status) else None
    return {k: v for k, v in nxt.items() if task.get(k) != v}


def task_variance_days(task: dict) -> int | None:
    """Positive = finishing later than baseline. None without a baseline."""
    if not task.get("baselineFinish"):
        return None
    return days_between(task["plannedFinish"], task["baselineFinish"])


def task_is_late(task: dict, today: str | None = None) -> bool:
    return not is_done(task["status"]) and task["plannedFinish"] < (today or today_iso())


def task_is_delayed(task: dict) -> bool:
    """Still open and planned to finish later than its baseline."""
    return not is_done(task["status"]) and (task_variance_days(task) or 0) > 0


def ordered_phases(setup: dict, tasks: list[dict]) -> list[str]:
    """Phases the project uses: its own custom ones first, then the company's in setup order."""
    present = {t["phase"] for t in tasks}
    custom = sorted(p for p in present if p not in setup["phases"])
    return custom + [p for p in setup["phases"] if p in present]


def current_phase(setup: dict, tasks: list[dict]) -> str | None:
    """Where work is happening now: the phase of an active task, else the first phase."""
    active = next((t["phase"] for t in tasks if t["status"] in ("in_progress", "blocked")), None)
    phases = ordered_phases(setup, tasks) or setup["phases"]
    return active or (phases[0] if phases else None)


def task_defaults(tasks: list[dict], phase: str, today: str | None = None) -> dict:
    """Dates for a new task: the day after the phase's last task ends (or today), three days long."""
    finishes = [t["plannedFinish"] for t in tasks if t["phase"] == phase]
    start = add_days(max(finishes), 1) if finishes else (today or today_iso())
    return {"phase": phase, "plannedStart": start, "plannedFinish": add_days(start, 2)}


PENDING_STATUSES = ["not_started", "in_progress", "blocked", "done_pending_confirmation"]
DUE_WINDOWS = {"week": 7, "month": 30}


def matches_task_filters(task: dict, f: dict, viewer_id: str, today: str | None = None) -> bool:
    """The schedule's filters. `f` holds statuses, owner ("me", "unassigned" or a user id),
    due ("overdue", "week", "month"), delayed and phases; anything left out matches everything."""
    today = today or today_iso()
    if f.get("statuses") and task["status"] not in f["statuses"]:
        return False
    owner = f.get("owner")
    if owner == "me" and task["ownerId"] != viewer_id:
        return False
    if owner == "unassigned" and task["ownerId"] is not None:
        return False
    if owner not in (None, "any", "me", "unassigned") and task["ownerId"] != owner:
        return False
    if f.get("phases") and task["phase"] not in f["phases"]:
        return False
    if f.get("delayed") and not task_is_delayed(task):
        return False
    due = f.get("due")
    if due in ("overdue", *DUE_WINDOWS):
        if is_done(task["status"]):  # due filters are about work still to do
            return False
        if due == "overdue":
            return task["plannedFinish"] < today
        return today <= task["plannedFinish"] <= add_days(today, DUE_WINDOWS[due])
    return True


def project_delay_days(project: dict) -> int:
    if not project["baselineLocked"] or not project["baselineFinish"]:
        return 0
    return days_between(project["plannedFinish"], project["baselineFinish"])


def iso_to_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
