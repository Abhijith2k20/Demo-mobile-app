"""Photo uploads. Files are kept on disk under backend/uploads/ and served by an unguessable id."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse

from ..core import invalid, not_found, uuid7
from ..deps import current_user
from ..store import S

router = APIRouter(tags=["uploads"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
MAX_BYTES = 10 * 1024 * 1024
ALLOWED = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic"}


@router.post("/uploads")
async def upload(request: Request, file: UploadFile = File(...), user: dict = Depends(current_user)):
    ext = ALLOWED.get(file.content_type or "")
    if not ext:
        raise invalid({"file": "Only photos can be uploaded"})
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise invalid({"file": "Photos must be under 10 MB"})
    UPLOAD_DIR.mkdir(exist_ok=True)
    upload_id = uuid7()
    path = UPLOAD_DIR / f"{upload_id}{ext}"
    path.write_bytes(data)
    url = str(request.url_for("get_file", upload_id=upload_id))
    S().uploads[upload_id] = {"id": upload_id, "userId": user["id"], "path": str(path), "contentType": file.content_type, "url": url}
    return {"uploadId": upload_id, "url": url}


@router.get("/files/{upload_id}", name="get_file")
async def get_file(upload_id: str):
    # shortcut: no auth on reads, the 128-bit id is the capability; add signed URLs for a real deployment.
    u = S().uploads.get(upload_id)
    if not u or not Path(u["path"]).exists():
        raise not_found("File")
    return FileResponse(u["path"], media_type=u["contentType"])
