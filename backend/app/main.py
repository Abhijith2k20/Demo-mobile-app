"""Siteline mock backend. Run: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import actors, bot, netsim
from .core import ApiError, ERROR_STATUS, uuid7
from .deps import user_for_token
from .events import cancel_all, hub
from .notify import reset_notify
from .routers import auth, channels, internal, me, messages, people, projects, tasks, uploads
from .store import reset_store

log = logging.getLogger("siteline")
DEMO = os.environ.get("SITELINE_DEMO", "1") != "0"


def reset_everything() -> None:
    reset_notify()
    bot.reset_bot()
    actors.reset()
    cancel_all()
    netsim.reset()
    hub.clear()
    reset_store()
    actors.start()


@asynccontextmanager
async def lifespan(_: FastAPI):
    reset_store()
    if os.environ.get("SITELINE_ACTORS", "1") != "0":
        actors.start()
    yield
    cancel_all()


app = FastAPI(title="Siteline mock API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def error_response(code: str, message: str, details: dict, request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=ERROR_STATUS[code],
        content={"error": {"code": code, "message": message, "details": details, "request_id": request_id}},
    )


def _request_id(request: Request) -> str:
    return request.headers.get("x-request-id") or f"req_{uuid7()}"


@app.exception_handler(ApiError)
async def api_error(request: Request, e: ApiError):
    return error_response(e.code, e.message, e.details, _request_id(request))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, e: RequestValidationError):
    fields: dict[str, str] = {}
    for err in e.errors():
        msg = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
        loc = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path")]
        if "|" in msg:  # model-level checks name their field: "plannedFinish|Finish must be…"
            field, msg = msg.split("|", 1)
            loc = [field]
        fields.setdefault(".".join(loc) or "_", msg)
    return error_response("VALIDATION_FAILED", "Some fields need attention.", {"fields": fields}, _request_id(request))


@app.exception_handler(Exception)
async def unexpected(request: Request, e: Exception):
    log.exception("unexpected error")
    return error_response("INTERNAL_ERROR", "Something went wrong on our side.", {}, _request_id(request))


@app.middleware("http")
async def simulate_network(request: Request, call_next):
    """Demo panel network conditions. Applies to user writes only (not sign-in or read markers)."""
    path = request.url.path
    is_write = request.method != "GET" and not path.startswith(("/auth", "/internal")) and not path.endswith("/read")
    await netsim.delay(path.startswith("/uploads"))
    if not is_write:
        return await call_next(request)
    inject = netsim.take_injection()
    flaky = "after" if inject == "timeout_after_save" else netsim.flaky_timeout()
    rid = _request_id(request)
    if flaky == "before":
        await asyncio.sleep(netsim.TIMEOUT_SECONDS)
        return error_response("SERVICE_UNAVAILABLE", "The server took too long to answer.", {}, rid)
    if inject == "500":
        return error_response("INTERNAL_ERROR", "Something went wrong on our side.", {}, rid)
    if inject == "403":
        return error_response("FORBIDDEN", "You don't have permission to do that.", {}, rid)
    if inject == "422":
        return error_response("VALIDATION_FAILED", "Some fields need attention.", {"fields": {"_": "Injected by the Demo panel"}}, rid)
    response = await call_next(request)
    if flaky == "after":
        # The change is saved, but the reply never reaches the app.
        await asyncio.sleep(netsim.TIMEOUT_SECONDS)
        return error_response("SERVICE_UNAVAILABLE", "The server took too long to answer.", {}, rid)
    return response


for r in (auth, me, people, projects, channels, messages, tasks, uploads):
    app.include_router(r.router)
if DEMO:
    app.include_router(internal.router)


@app.get("/health")
async def health():
    return {"ok": True}


@app.websocket("/ws")
async def events(ws: WebSocket, token: str = ""):
    """Live updates. Connect with ?token=<access token>; events arrive as JSON text frames."""
    try:
        user = user_for_token(token)
    except ApiError:
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.add(user["id"], ws)
    try:
        while True:
            await ws.receive_text()  # pings from the app; nothing else is expected
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(user["id"], ws)
