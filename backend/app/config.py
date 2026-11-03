"""Settings from the environment (spec §10.2). Locally they come from backend/.env (see .env.example); on Render from the
dashboard. Nothing falls back to a development value unless SITELINE_ENV says development."""
from __future__ import annotations

import os

ENV = os.environ.get("SITELINE_ENV", "")
if ENV not in ("development", "staging", "production"):
    # No default: a forgotten or mistyped setting must stop the server, not quietly turn on development behaviour.
    raise RuntimeError(f"SITELINE_ENV must be development, staging or production (got {ENV!r}). Locally: cp .env.example .env")
PRODUCTION = ENV == "production"
DEVELOPMENT = ENV == "development"

# Signs code hashes and encrypts PM keys. Must be set (and secret) outside development; changing it breaks saved PM keys.
SECRET = os.environ.get("SITELINE_SECRET", "dev-only-secret-change-me" if DEVELOPMENT else "")

# Staging and development: the seeded test accounts sign in with this code. Never in production, and never for
# anyone else (staging is on the internet: a real invited person still gets a real code).
FIXED_CODE = os.environ.get("SITELINE_FIXED_CODE", "" if PRODUCTION else "123456")
TEST_ACCOUNTS = ("@paliath.in", "@brightline.events", "@siteline.app")


def fixed_code_for(identifier: str) -> str | None:
    """The fixed code when this is a seeded test account (outside production), else None."""
    return FIXED_CODE if FIXED_CODE and identifier.endswith(TEST_ACCOUNTS) else None

# Siteline staff who may sign in to the platform panel (comma-separated emails), added at start-up. Without this a
# fresh production database has nobody who can open the panel. Being listed only lets them ask for a code.
PLATFORM_ADMINS = [e.strip().lower() for e in os.environ.get("SITELINE_PLATFORM_ADMINS", "").split(",") if e.strip()]

# Protects POST /platform/companies (the PM app or a script calls it).
PLATFORM_KEY = os.environ.get("SITELINE_PLATFORM_KEY", "dev-platform-key" if DEVELOPMENT else "")

# Seed data, scripted teammates, network simulation and /internal routes (§13).
DEV_TOOLS = not PRODUCTION and os.environ.get("SITELINE_DEMO", "1") != "0"

# Where files go: "local" (backend/uploads) or "r2" (Cloudflare R2; needs the R2_* settings).
STORAGE = os.environ.get("SITELINE_STORAGE", "local")

# Public address of this API, for links in invites and files.
PUBLIC_URL = os.environ.get("SITELINE_PUBLIC_URL", "http://localhost:8000")
APP_LINK = os.environ.get("SITELINE_APP_LINK", "https://siteline.app/get")

ACCESS_TTL_SECONDS = 60 * 60
REFRESH_TTL_SECONDS = 60 * 24 * 60 * 60
INVITE_TTL_DAYS = 14


def check() -> None:
    """Called at start-up. Staging is on the internet too: it needs real secrets, only production refuses demo features."""
    problems = []
    if not DEVELOPMENT:
        if SECRET.startswith("dev-") or len(SECRET) < 32:
            problems.append("SITELINE_SECRET must be a long random value")
        if not PLATFORM_KEY or PLATFORM_KEY.startswith("dev-") or len(PLATFORM_KEY) < 24:
            problems.append("SITELINE_PLATFORM_KEY must be a long random value")
    if PRODUCTION:
        if FIXED_CODE:
            problems.append("SITELINE_FIXED_CODE is not allowed in production")
        if STORAGE != "r2":  # local files live on the server's disk, which Render wipes on every deploy
            problems.append("SITELINE_STORAGE must be r2")
        if not PUBLIC_URL.startswith("https://"):  # file links and invites point here
            problems.append("SITELINE_PUBLIC_URL must be the https address of the API")
    if problems:
        raise RuntimeError(f"Unsafe {ENV} settings: " + "; ".join(problems))
