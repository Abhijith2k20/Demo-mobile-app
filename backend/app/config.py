"""Settings from the environment (spec §10.2). Production refuses unsafe values at start-up."""
from __future__ import annotations

import os

ENV = os.environ.get("SITELINE_ENV", "development")  # development | staging | production
PRODUCTION = ENV == "production"

# Signs code hashes and encrypts PM keys. Must be set (and secret) outside development.
SECRET = os.environ.get("SITELINE_SECRET", "dev-only-secret-change-me")

# Staging and development: every sign-in code is this, so seeded accounts can sign in. Never in production.
FIXED_CODE = os.environ.get("SITELINE_FIXED_CODE", "" if PRODUCTION else "123456")

# Protects POST /platform/companies (the PM app or a script calls it).
PLATFORM_KEY = os.environ.get("SITELINE_PLATFORM_KEY", "" if PRODUCTION else "dev-platform-key")

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
    """Called at start-up."""
    if PRODUCTION:
        problems = []
        if SECRET.startswith("dev-") or len(SECRET) < 32:
            problems.append("SITELINE_SECRET must be a long random value")
        if FIXED_CODE:
            problems.append("SITELINE_FIXED_CODE is not allowed in production")
        if not PLATFORM_KEY or len(PLATFORM_KEY) < 24:
            problems.append("SITELINE_PLATFORM_KEY must be set")
        if problems:
            raise RuntimeError("Unsafe production settings: " + "; ".join(problems))
