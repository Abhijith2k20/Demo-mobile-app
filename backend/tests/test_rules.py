"""Unit tests for the business rules (ported from the app's old TypeScript rule tests)."""
from app.rules import (
    PROJECT_PERMISSIONS,
    can,
    can_deactivate,
    can_invite_as,
    can_post,
    default_channel_names,
    job_title_error,
    simple_mode,
)
from app.schemas import normalize_channel_name

OWNER, ADMIN, MEMBER = {"companyRole": "owner"}, {"companyRole": "admin"}, {"companyRole": "member"}


def test_owner_and_admin_can_do_every_project_action():
    for action in PROJECT_PERMISSIONS["manager"]:
        assert can(OWNER, action, None) and can(ADMIN, action, None)


def test_project_roles():
    assert can(MEMBER, "channel.manage", "manager") and can(MEMBER, "message.pin", "manager")
    assert not can(MEMBER, "channel.manage", "member") and not can(MEMBER, "message.pin", "member")
    assert not can(MEMBER, "project.edit", None)
    assert not can(MEMBER, "project.delete", "manager")  # unknown to project roles


def test_posting_policy():
    announcements = {"postingPolicy": "admins", "kind": "company"}
    assert can_post(OWNER, announcements) and can_post(ADMIN, announcements) and not can_post(MEMBER, announcements)
    assert can_post(MEMBER, {"postingPolicy": "everyone", "kind": "project"})
    assert not can_post(OWNER, {"postingPolicy": "everyone", "kind": "bot"})


# A company from another industry: nothing in the rules should assume interior design.
EVENTS = {
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


def test_job_titles_and_simple_mode_come_from_the_setup():
    assert job_title_error(EVENTS, "member", "Crew") is None
    assert job_title_error(EVENTS, "member", "Lead") == "This job title is for managers"
    assert job_title_error(EVENTS, "manager", "Lead") is None
    assert job_title_error(EVENTS, "member", "Designer") == "Pick one of the company's job titles"
    assert simple_mode(EVENTS, ["Crew", "Crew"]) and not simple_mode(EVENTS, ["Crew", "Coordinator"])
    assert not simple_mode(EVENTS, [])


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
