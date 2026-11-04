import os
import subprocess
import sys
from pathlib import Path

import pytest

from app import config

BACKEND = Path(__file__).parent.parent


def _start(env_value: str | None) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != "SITELINE_ENV"}
    if env_value is not None:
        env["SITELINE_ENV"] = env_value
    return subprocess.run([sys.executable, "-c", "import app.config"], cwd=BACKEND, env=env, capture_output=True, text=True)


def test_the_server_will_not_start_without_saying_which_environment_it_is():
    for value in (None, "", "prod", "Production"):
        r = _start(value)
        assert r.returncode != 0 and "SITELINE_ENV must be" in r.stderr, value
    assert _start("development").returncode == 0


def test_staging_needs_real_secrets_but_keeps_demo_features(monkeypatch):
    monkeypatch.setattr(config, "DEVELOPMENT", False)
    monkeypatch.setattr(config, "ENV", "staging")
    monkeypatch.setattr(config, "SECRET", "dev-only-secret-change-me")
    monkeypatch.setattr(config, "PLATFORM_KEY", "dev-platform-key")
    with pytest.raises(RuntimeError, match="staging.*SITELINE_SECRET.*SITELINE_PLATFORM_KEY"):
        config.check()
    monkeypatch.setattr(config, "SECRET", "s" * 40)
    monkeypatch.setattr(config, "PLATFORM_KEY", "k" * 30)
    config.check()  # the demo code and local storage are fine on staging


def test_the_demo_code_opens_the_platform_panel_only_in_development(client, monkeypatch):
    monkeypatch.setattr(config, "DEVELOPMENT", False)
    client.post("/platform/login", data={"email": "admin@siteline.app"})
    r = client.post("/platform/verify", data={"email": "admin@siteline.app", "code": "123456"}, follow_redirects=False)
    assert "siteline_platform" not in r.headers.get("set-cookie", "")


def test_dev_routes_answer_only_demo_accounts_outside_development(login, monkeypatch):
    ravi = login("ravi@paliath.in")
    assert ravi.get("/internal/state").status_code == 200
    monkeypatch.setattr(config, "DEVELOPMENT", False)
    assert ravi.get("/internal/state").status_code == 200  # a seeded demo account (staging keeps the dev panel)
    monkeypatch.setattr(config, "TEST_ACCOUNTS", ("@demo-only.example",))
    assert ravi.get("/internal/state").status_code == 404
    assert ravi.post("/internal/reset").status_code == 404  # a real account can't wipe staging


def test_the_platform_task_form_refuses_made_up_statuses_and_dates(client):
    from app import db

    client.post("/platform/login", data={"email": "admin@siteline.app"})
    client.post("/platform/verify", data={"email": "admin@siteline.app", "code": "123456"})
    with db.transaction():
        cid = db.value("SELECT id FROM companies WHERE name = 'Paliath Interiors'")
        db.current().set_company(cid)
        project = db.value("SELECT id FROM pm_mock_projects LIMIT 1")
    form = {"project_id": project, "name": "Test task", "planned_start": "2026-11-04", "planned_finish": "2026-11-05"}
    r = client.post(f"/platform/companies/{cid}/mock/tasks", data={**form, "status": "hacked"}, follow_redirects=False)
    assert "Pick+one+of+the+task+statuses" in r.headers["location"]
    r = client.post(f"/platform/companies/{cid}/mock/tasks", data={**form, "status": "done", "planned_start": "soon"}, follow_redirects=False)
    assert "Dates+must+be+real+dates" in r.headers["location"]
    r = client.post(f"/platform/companies/{cid}/mock/tasks", data={**form, "status": "done"}, follow_redirects=False)
    assert "Task+saved" in r.headers["location"]
