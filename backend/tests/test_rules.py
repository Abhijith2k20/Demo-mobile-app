"""Unit tests for the business rules (ported from the app's old TypeScript rule tests)."""
from app.rules import PROJECT_ACTIONS, can, can_deactivate, can_invite_as, can_post, project_permissions
from app.schemas import normalize_channel_name

OWNER, ADMIN, MEMBER = {"companyRole": "owner"}, {"companyRole": "admin"}, {"companyRole": "member"}


def test_only_the_owner_and_admins_run_projects_and_channels():
    for action in PROJECT_ACTIONS:
        assert can(OWNER, action) and can(ADMIN, action) and not can(MEMBER, action)
    assert project_permissions(MEMBER, False) == []
    assert project_permissions(ADMIN, True) == ["project.archive", "project.delete"]  # archived: read-only


def test_posting_policy():
    announcements = {"postingPolicy": "admins", "kind": "company"}
    assert can_post(OWNER, announcements) and can_post(ADMIN, announcements) and not can_post(MEMBER, announcements)
    assert can_post(MEMBER, {"postingPolicy": "everyone", "kind": "project"})
    assert not can_post(OWNER, {"postingPolicy": "everyone", "kind": "bot"})


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
