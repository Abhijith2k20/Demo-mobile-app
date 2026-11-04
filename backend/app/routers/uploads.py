"""Uploads (spec §10.3): photos up to 10 MB, voice notes up to 5 MB, PDFs and images as files up to 25 MB.
Files are fetched only through signed links (services/files.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, RedirectResponse

from .. import config, db
from ..core import ApiError, invalid, not_found, uuid7
from ..deps import current_user
from ..services import files, limits

router = APIRouter(tags=["uploads"])


@router.post("/uploads")
def upload(file: UploadFile = File(...), kind: str = Form("image"), user: dict = Depends(current_user)):
    limits.hit(user["id"], "upload")
    rule = files.KINDS.get(kind)
    if not rule:
        raise invalid({"kind": "Unknown kind"})
    data = file.file.read(rule["max"] + 1)
    if len(data) > rule["max"]:
        raise ApiError("FILE_TOO_LARGE", f"Files like this must be under {rule['max'] // (1024 * 1024)} MB.",
                       {"fields": {"file": "Too large"}})
    content_type = files.sniff(data)
    if content_type not in rule["types"]:
        raise invalid({"file": "Only photos can be uploaded" if kind == "image" else "This kind of file can't be sent"})
    upload_id = uuid7()
    key = files.key_for(db.company_id(), upload_id, content_type)
    files.save(key, data, content_type)
    db.insert("uploads", {"id": upload_id, "companyId": db.company_id(), "userId": user["id"], "key": key, "kind": kind,
                          "name": (file.filename or "")[:120] or None, "contentType": content_type, "size": len(data)})
    return {"uploadId": upload_id, "url": files.signed_url(db.company_id(), upload_id)}


@router.get("/files/{company_id}/{upload_id}", name="get_file")
def get_file(company_id: str, upload_id: str, exp: int = Query(0), sig: str = Query("")):
    """Works only with a signature made when the message was shown to someone allowed to see it."""
    if not files.check_signature(company_id, upload_id, exp, sig):
        raise not_found("File")
    db.current().set_company(company_id)  # the signature proves this link was handed out by that company
    up = db.row("SELECT * FROM uploads WHERE id = %(id)s", id=upload_id)
    if not up:
        raise not_found("File")
    if config.STORAGE == "r2":
        return RedirectResponse(files.r2_link(up["key"]), status_code=302)
    path = files.local_path(up["key"])
    if not path.exists():
        raise not_found("File")
    return FileResponse(path, media_type=up["contentType"], headers={"Cache-Control": "private, max-age=3600"})
