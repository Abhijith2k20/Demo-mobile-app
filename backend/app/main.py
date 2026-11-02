"""Siteline API. Run: uvicorn app.main:app --host 0.0.0.0 --port 8000 (and `python -m app.worker` for jobs,
unless SITELINE_WORKER=inline runs them inside this process)."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import errors as pg_errors

from . import config, db, netsim
from .core import ApiError, ERROR_STATUS, uuid7
from .deps import user_for_token
from .events import cancel_all, hub, listen
from .logs import request_id, setup_logging
from .routers import auth, cards, channels, integration_api, internal, me, messages, people, platform, projects, uploads

log = logging.getLogger("siteline")


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_logging()
    config.check()
    await run_in_threadpool(db.migrate)
    if config.DEV_TOOLS and os.environ.get("SITELINE_SEED", "1") != "0":
        await run_in_threadpool(_seed_if_empty)
    stop = asyncio.Event()
    listener = asyncio.create_task(listen(stop))
    worker_stop = None
    if os.environ.get("SITELINE_WORKER", "inline" if config.ENV == "development" else "") == "inline":
        from .worker import start_inline

        worker_stop = start_inline()
    if config.DEV_TOOLS and os.environ.get("SITELINE_ACTORS", "1") != "0":
        from . import actors

        actors.start()
    yield
    stop.set()
    if worker_stop:
        worker_stop.set()
    cancel_all()
    await listener
    db.close_pool()


def _seed_if_empty() -> None:
    """Development and staging: an empty database gets the seed (spec §11)."""
    with db.transaction():
        empty = not db.value("SELECT 1 FROM companies LIMIT 1")
    if empty:
        from .seed import reset_everything

        reset_everything()


app = FastAPI(title="Siteline API", version="2.0", lifespan=lifespan,
              docs_url=None if config.PRODUCTION else "/docs", redoc_url=None, openapi_url=None if config.PRODUCTION else "/openapi.json")


def error_response(code: str, message: str, details: dict, rid: str) -> JSONResponse:
    return JSONResponse(
        status_code=ERROR_STATUS[code],
        content={"error": {"code": code, "message": message, "details": details, "request_id": rid}},
    )


@app.exception_handler(ApiError)
async def api_error(request: Request, e: ApiError):
    return error_response(e.code, e.message, e.details, request_id.get())


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
    return error_response("VALIDATION_FAILED", "Some fields need attention.", {"fields": fields}, request_id.get())


@app.exception_handler(pg_errors.UniqueViolation)
async def id_taken(request: Request, e: pg_errors.UniqueViolation):
    # An id made on the phone that already exists (in this company or, hidden by row-level security, another).
    return error_response("VALIDATION_FAILED", "Some fields need attention.", {"fields": {"id": "Already used"}},
                          request_id.get())


@app.exception_handler(Exception)
async def unexpected(request: Request, e: Exception):
    log.exception("unexpected error")
    return error_response("INTERNAL_ERROR", "Something went wrong on our side.", {}, request_id.get())


@app.middleware("http")
async def transaction(request: Request, call_next):
    """One database transaction per request. Refusals (4xx) still commit what was written before them
    (a wrong sign-in code counts); server errors roll back."""
    request_id.set(request.headers.get("x-request-id") or f"req_{uuid7()}")
    t, token = db.begin()
    try:
        response = await call_next(request)
    except BaseException as e:
        await run_in_threadpool(t.finish, e)
        db.forget(token)
        raise
    try:
        await run_in_threadpool(t.finish, RuntimeError("server error") if response.status_code >= 500 else None)
    finally:
        db.forget(token)
    return response


@app.middleware("http")
async def simulate_network(request: Request, call_next):
    """Dev panel network conditions (§13). Applies to user writes only (not sign-in or read markers)."""
    if not config.DEV_TOOLS:
        return await call_next(request)
    path = request.url.path
    is_write = request.method != "GET" and not path.startswith(("/auth", "/internal", "/platform", "/api/v1")) \
        and not path.endswith("/read")
    await netsim.delay(path.startswith("/uploads"))
    if not is_write:
        return await call_next(request)
    inject = netsim.take_injection()
    flaky = "after" if inject == "timeout_after_save" else netsim.flaky_timeout()
    rid = request.headers.get("x-request-id") or f"req_{uuid7()}"
    if flaky == "before":
        await asyncio.sleep(netsim.TIMEOUT_SECONDS)
        return error_response("SERVICE_UNAVAILABLE", "The server took too long to answer.", {}, rid)
    if inject == "500":
        return error_response("INTERNAL_ERROR", "Something went wrong on our side.", {}, rid)
    if inject == "403":
        return error_response("FORBIDDEN", "You don't have permission to do that.", {}, rid)
    if inject == "422":
        return error_response("VALIDATION_FAILED", "Some fields need attention.", {"fields": {"_": "Injected by the dev panel"}}, rid)
    response = await call_next(request)
    if flaky == "after":
        # The change is saved, but the reply never reaches the app.
        await asyncio.sleep(netsim.TIMEOUT_SECONDS)
        return error_response("SERVICE_UNAVAILABLE", "The server took too long to answer.", {}, rid)
    return response


for r in (auth, me, people, projects, channels, messages, cards, uploads, integration_api, platform):
    app.include_router(r.router)
if config.DEV_TOOLS:
    app.include_router(internal.router)


@app.get("/health")
def health():
    """Database reachable, and the worker seen in the last two minutes."""
    worker = db.value("SELECT seen_at > now() - interval '2 minutes' FROM worker_heartbeat")
    return {"ok": True, "worker": bool(worker)}


@app.websocket("/ws")
async def events(ws: WebSocket, token: str = ""):
    """Live updates. Connect with ?token=<access token>; events for that session's company arrive as JSON."""

    def who() -> tuple[dict, str]:
        with db.transaction() as t:
            user = user_for_token(token)
            return user, t.company_id

    try:
        user, company_id = await run_in_threadpool(who)
    except ApiError:
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.add(user["id"], company_id, ws)
    try:
        while True:
            await ws.receive_text()  # pings from the app; nothing else is expected
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(user["id"], ws)
