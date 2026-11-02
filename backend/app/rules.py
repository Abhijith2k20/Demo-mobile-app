"""Business rules. The server is the only place they live: the app just shows the results."""
from __future__ import annotations

from datetime import date

# ---- Permissions (spec §9) ----

PROJECT_PERMISSIONS: dict[str, list[str]] = {
    "manager": [
        "project.edit",
        "project.members",
        "channel.manage",
        "message.delete_any",
        "message.pin",
    ],
    "member": [],
}
ALL_PROJECT_ACTIONS = sorted({a for acts in PROJECT_PERMISSIONS.values() for a in acts})

EDIT_WINDOW_MS = 15 * 60 * 1000
DELETE_WINDOW_MS = 60 * 60 * 1000
PERCENT_STEPS = [25, 50, 75, 90, 100]  # the check-in scale
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


# ---- The company's own setup (job titles, channels, problem types; see seed.py) ----
# Nothing below knows an industry: each company's words and defaults are data.

def localized(label: dict | str, lang: str) -> str:
    """A setup label in the reader's language, falling back to English."""
    return label if isinstance(label, str) else label.get(lang) or label["en"]


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


# ---- PM tasks and check-ins (spec §8) ----
# Tasks belong to the PM app; these rules only decide what the bot asks and what an answer means.

OPEN_TASK_STATUSES = ("not_started", "in_progress", "blocked")


def task_is_overdue(task: dict, today: str | None = None) -> bool:
    return task["status"] in OPEN_TASK_STATUSES and task["plannedFinish"] < (today or today_iso())


def task_needs_update(task: dict, today: str | None = None) -> bool:
    """Active (started, not past its finish) or overdue, and not done: the bot asks about these."""
    today = today or today_iso()
    return task["status"] in OPEN_TASK_STATUSES and task["plannedStart"] <= today


def pm_change_for(answer: dict) -> dict | None:
    """What a check-in answer tells the PM app. "Not started" tells it nothing."""
    kind = answer["kind"]
    if kind == "progress":
        percent = answer.get("percent")
        return {"status": "done"} if percent == 100 else {"status": "in_progress", "percent": percent}
    return {
        "started": {"status": "in_progress"},
        "problem": {"status": "blocked", "problem": answer.get("reason")},
        "done": {"status": "done"},
    }.get(kind)
