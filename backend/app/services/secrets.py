"""Encrypting stored secrets (PM API keys, webhook secrets) with a key derived from SITELINE_SECRET."""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from .. import config


def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("pm-keys:" + config.SECRET).encode()).digest()))


def encrypt(value: str | None) -> str | None:
    return _fernet().encrypt(value.encode()).decode() if value else None


def decrypt(value: str | None) -> str | None:
    return _fernet().decrypt(value.encode()).decode() if value else None
