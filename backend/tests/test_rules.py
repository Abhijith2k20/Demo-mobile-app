"""Unit tests for the business rules (ported from the app's old TypeScript rule tests)."""
from app.rules import (
    PROJECT_PERMISSIONS,
    can,
    can_deactivate,
    can_invite_as,
    can_post,
    current_phase,
    default_channel_names,
    job_title_error,
    matches_task_filters,
    next_stage,
    normalize_task_change,
    ordered_phases,
    simple_mode,
    task_defaults,
    project_delay_days,
    task_variance_days,
)
from app.schemas import normalize_channel_name

TODAY = "2026-10-09"
OWNER, ADMIN, MEMBER = {"companyRole": "owner"}, {"companyRole": "admin"}, {"companyRole": "member"}


def task(**over):
    base = {"status": "not_started", "percent": 0, "actualStart": None, "actualFinish": None, "name": "Wardrobe",
            "plannedStart": "2026-10-05", "plannedFinish": "2026-10-12", "baselineFinish": None}
    return base | over


# ---- Task changes ----

def test_first_progress_starts_the_task():
    assert normalize_task_change(task(), {"percent": 25}, False, TODAY) == {"percent": 25, "status": "in_progress", "actualStart": TODAY}


def test_member_100_waits_for_a_manager_and_manager_100_is_done():
    started = task(status="in_progress", percent=75, actualStart="2026-10-05")
    assert normalize_task_change(started, {"percent": 100}, False, TODAY) == {
        "percent": 100, "status": "done_pending_confirmation", "actualFinish": TODAY}
    assert normalize_task_change(started, {"percent": 100}, True, TODAY) == {"percent": 100, "status": "done", "actualFinish": TODAY}


def test_marking_done_sets_100_percent():
    started = task(status="in_progress", percent=50, actualStart="2026-10-05")
    assert normalize_task_change(started, {"status": "done"}, True, TODAY) == {"status": "done", "percent": 100, "actualFinish": TODAY}


def test_reopening_clears_finish_and_drops_below_100():
    done = task(status="done", percent=100, actualStart="2026-10-05", actualFinish="2026-10-08")
    assert normalize_task_change(done, {"status": "in_progress"}, True, TODAY) == {"status": "in_progress", "percent": 90, "actualFinish": None}


def test_back_to_not_started_resets_progress_and_start():
    started = task(status="in_progress", percent=50, actualStart="2026-10-05")
    assert normalize_task_change(started, {"status": "not_started"}, True, TODAY) == {"status": "not_started", "percent": 0, "actualStart": None}


def test_no_op_values_are_dropped_and_dates_left_alone():
    started = task(status="in_progress", percent=50, actualStart="2026-10-05")
    assert normalize_task_change(started, {"percent": 50, "name": "Wardrobe"}, True, TODAY) == {}
    assert normalize_task_change(task(), {"plannedFinish": "2026-10-14"}, True, TODAY) == {"plannedFinish": "2026-10-14"}


# ---- Baseline variance ----

def test_variance_and_delay():
    assert task_variance_days(task()) is None
    assert task_variance_days(task(plannedFinish="2026-10-16", baselineFinish="2026-10-12")) == 4
    assert task_variance_days(task(plannedFinish="2026-10-11", baselineFinish="2026-10-12")) == -1
    assert project_delay_days({"plannedFinish": "2026-11-04", "baselineFinish": "2026-10-31", "baselineLocked": False}) == 0
    assert project_delay_days({"plannedFinish": "2026-11-04", "baselineFinish": "2026-10-31", "baselineLocked": True}) == 4


# ---- Permissions ----

def test_owner_and_admin_can_do_every_project_action():
    for action in PROJECT_PERMISSIONS["manager"]:
        assert can(OWNER, action, None) and can(ADMIN, action, None)


def test_project_roles():
    assert can(MEMBER, "task.edit_any", "manager") and can(MEMBER, "channel.manage", "manager")
    assert can(MEMBER, "task.create", "member") and can(MEMBER, "task.update_own", "member")
    assert not can(MEMBER, "task.edit_any", "member") and not can(MEMBER, "task.baseline", "member")
    assert not can(MEMBER, "task.create", None)
    assert not can(MEMBER, "project.delete", "manager")  # unknown to project roles


def test_posting_policy():
    announcements = {"postingPolicy": "admins", "kind": "company"}
    assert can_post(OWNER, announcements) and can_post(ADMIN, announcements) and not can_post(MEMBER, announcements)
    assert can_post(MEMBER, {"postingPolicy": "everyone", "kind": "project"})
    assert not can_post(OWNER, {"postingPolicy": "everyone", "kind": "bot"})


# A company from another industry: nothing in the rules should assume interior design.
EVENTS = {
    "stages": [{"key": "plan", "label": "Plan"}, {"key": "book", "label": "Book"}, {"key": "run", "label": "Run"}],
    "phases": ["Venue", "Catering", "Sound"],
    "projectChannels": [{"name": "general"}, {"name": "vendors"}, {"name": "on-the-day"}, {"name": "budget", "private": True}],
    "workChannel": "on-the-day",
    "jobTitles": [
        {"name": "Lead", "label": "Lead", "managersOnly": True, "channels": ["general", "vendors"]},
        {"name": "Coordinator", "label": "Coordinator", "channels": ["vendors", "general"]},
        {"name": "Crew", "label": "Crew", "channels": ["on-the-day", "general"], "simpleMode": True},
    ],
    "defaultJobTitle": "Crew",
    "problemTypes": [{"key": "No-show vendor", "label": "No-show vendor"}],
}


def test_default_channels_come_from_the_company_setup():
    assert default_channel_names(EVENTS, "manager", "Crew") == ["general", "vendors", "on-the-day", "budget"]
    assert default_channel_names(EVENTS, "member", "Coordinator") == ["vendors", "general"]
    assert default_channel_names(EVENTS, "member", "Unknown") == ["general"]


def test_job_titles_stages_and_simple_mode_come_from_the_setup():
    assert job_title_error(EVENTS, "member", "Crew") is None
    assert job_title_error(EVENTS, "member", "Lead") == "This job title is for managers"
    assert job_title_error(EVENTS, "manager", "Lead") is None
    assert job_title_error(EVENTS, "member", "Designer") == "Pick one of the company's job titles"
    assert next_stage(EVENTS, "plan") == "book" and next_stage(EVENTS, "run") is None
    assert simple_mode(EVENTS, ["Crew", "Crew"]) and not simple_mode(EVENTS, ["Crew", "Coordinator"])
    assert not simple_mode(EVENTS, [])


def _task(**over):
    t = {"id": "t1", "phase": "Venue", "ownerId": "me", "status": "in_progress", "plannedStart": "2026-10-05",
         "plannedFinish": "2026-10-12", "baselineFinish": None}
    return {**t, **over}


def test_phases_and_new_task_defaults():
    tasks = [_task(phase="Sound", status="not_started", plannedFinish="2026-10-20"), _task(phase="Lighting")]
    assert ordered_phases(EVENTS, tasks) == ["Lighting", "Sound"]  # custom first, then setup order
    assert current_phase(EVENTS, tasks) == "Lighting"  # where work is happening
    assert current_phase(EVENTS, []) == "Venue"
    assert task_defaults(tasks, "Sound", TODAY) == {"phase": "Sound", "plannedStart": "2026-10-21", "plannedFinish": "2026-10-23"}
    assert task_defaults(tasks, "Venue", TODAY) == {"phase": "Venue", "plannedStart": TODAY, "plannedFinish": "2026-10-11"}


def test_schedule_filters():
    match = lambda t, **f: matches_task_filters(t, f, "me", TODAY)  # noqa: E731
    assert match(_task()) and match(_task(status="done", ownerId=None))
    pending = ["not_started", "in_progress", "blocked", "done_pending_confirmation"]
    assert not match(_task(status="done"), statuses=pending) and match(_task(status="blocked"), statuses=pending)
    assert not match(_task(ownerId="other"), owner="me") and match(_task(ownerId=None), owner="unassigned")
    assert match(_task(ownerId="ravi"), owner="ravi") and not match(_task(ownerId=None), owner="ravi")
    # Overdue: finish date passed and not done.
    assert match(_task(plannedFinish="2026-10-08"), due="overdue") and not match(_task(plannedFinish=TODAY), due="overdue")
    assert not match(_task(plannedFinish="2026-10-08", status="done"), due="overdue")
    # This week: today and the next seven days.
    assert match(_task(plannedFinish=TODAY), due="week") and match(_task(plannedFinish="2026-10-16"), due="week")
    assert not match(_task(plannedFinish="2026-10-17"), due="week") and not match(_task(plannedFinish="2026-10-08"), due="week")
    # Delayed: later than baseline and still open.
    assert match(_task(baselineFinish="2026-10-10"), delayed=True)
    assert not match(_task(baselineFinish="2026-10-12"), delayed=True)
    assert not match(_task(baselineFinish="2026-10-10", status="done"), delayed=True)
    assert not match(_task(), phases=["Sound"]) and match(_task(), phases=["Sound", "Venue"])
    assert not match(_task(ownerId="other"), phases=["Venue"], owner="me")


def test_channel_name_normalising():
    assert normalize_channel_name("  Vendor Payments ") == "vendor-payments"
    assert normalize_channel_name("#Site_Work") == "site-work"
    assert normalize_channel_name("Q&A!!") == "qa"
    assert normalize_channel_name("--a--b--") == "a-b"


def test_invite_and_deactivate_rules():
    assert can_invite_as(OWNER, "admin") and can_invite_as(OWNER, "member")
    assert can_invite_as(ADMIN, "member") and not can_invite_as(ADMIN, "admin")
    assert not can_invite_as(MEMBER, "member")
    o, a, a2, m, m2 = ({"id": i, "companyRole": r} for i, r in
                       (("o", "owner"), ("a", "admin"), ("a2", "admin"), ("m", "member"), ("m2", "member")))
    assert can_deactivate(o, a) and can_deactivate(o, m) and can_deactivate(a, m)
    assert not can_deactivate(a, a2) and not can_deactivate(a, o)
    assert not can_deactivate(o, o) and not can_deactivate(m, m2)
