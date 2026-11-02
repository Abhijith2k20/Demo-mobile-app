"""Photos, voice notes and files (spec §10.3, §9.7 rule 5). Stored under a key that starts with the company
id, on local disk in development or in Cloudflare R2. The app only ever gets signed links, made when a
message is shown to someone who can see it."""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from pathlib import Path

from .. import config

LOCAL_DIR = Path(__file__).resolve().parents[2] / "uploads"
LINK_SECONDS = 5 * 60  # a link to R2 works this long

KINDS = {
    "image": {"max": 10 * 1024 * 1024, "types": {"image/jpeg", "image/png", "image/webp", "image/heic"}},
    "voice": {"max": 5 * 1024 * 1024, "types": {"audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg"}},
    "file": {"max": 25 * 1024 * 1024, "types": {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"}},
}
EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "application/pdf": ".pdf",
       "audio/mp4": ".m4a", "audio/m4a": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac", "audio/mpeg": ".mp3"}


def sniff(data: bytes) -> str | None:
    """The real type from the first bytes; the name and the phone's claim are not trusted."""
    head = data[:16]
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"heic", b"heix", b"mif1", b"msf1"):
            return "image/heic"
        return "audio/mp4"  # M4A voice notes (an MP4 container)
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if head[:2] in (b"\xff\xf1", b"\xff\xf9"):
        return "audio/aac"
    return None


def key_for(company_id: str, upload_id: str, content_type: str) -> str:
    return f"{company_id}/{upload_id}{EXT.get(content_type, '')}"


# ---- Storage ----

def _r2():
    import boto3

    return boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"], aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")


def save(key: str, data: bytes, content_type: str) -> None:
    if config.STORAGE == "r2":
        _r2().put_object(Bucket=os.environ["R2_BUCKET"], Key=key, Body=data, ContentType=content_type)
        return
    path = LOCAL_DIR / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def local_path(key: str) -> Path:
    return LOCAL_DIR / key


def r2_link(key: str) -> str:
    return _r2().generate_presigned_url("get_object", Params={"Bucket": os.environ["R2_BUCKET"], "Key": key},
                                        ExpiresIn=LINK_SECONDS)


# ---- Signed links ----

def _sig(company_id: str, upload_id: str, exp: int) -> str:
    msg = f"file:{company_id}:{upload_id}:{exp}".encode()
    return hmac.new(config.SECRET.encode(), msg, hashlib.sha256).hexdigest()[:32]


def signed_url(company_id: str, upload_id: str) -> str:
    """A link that works until the end of the next hour. It stays the same within the hour, so the phone's
    image cache keeps working. The company is part of the signed link, so it can't point anywhere else."""
    exp = (int(time.time()) // 3600 + 2) * 3600
    return f"{config.PUBLIC_URL}/files/{company_id}/{upload_id}?exp={exp}&sig={_sig(company_id, upload_id, exp)}"


def check_signature(company_id: str, upload_id: str, exp: int, sig: str) -> bool:
    return exp > time.time() and hmac.compare_digest(sig, _sig(company_id, upload_id, exp))
