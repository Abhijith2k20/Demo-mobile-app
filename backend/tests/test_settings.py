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
