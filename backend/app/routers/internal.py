"""Dev panel controls (spec §13). Only mounted outside production (config.DEV_TOOLS). Bot and account actions
apply to the signed-in person in their current company."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import actors, bot, db, netsim
from ..deps import current_user
from ..events import hub
from ..jobs.queue import enqueue
from ..pm import mock
from ..schemas import ActorsConfig, NetworkConfig
from ..services import accounts

router = APIRouter(prefix="/internal", tags=["dev"])


@router.get("/state")
def state():
    return {"network": netsim.state(), "actorsPaused": actors.paused(),
            "connections": {k: len(v) for k, v in hub.conns.items()}}


@router.post("/reset")
def reset():
    from ..seed import reset_everything

    reset_everything()
    return {"reset": True}


@router.post("/network")
def network(body: NetworkConfig):
    netsim.configure(body.mode, body.inject)
    return netsim.state()


@router.post("/actors")
def set_actors(body: ActorsConfig):
    actors.set_paused(body.paused)
    return {"actorsPaused": actors.paused()}


@router.post("/actors/rohan-posts")
def rohan_posts(user: dict = Depends(current_user)):
    actors.rohan_posts_qs(0)
    return {"ok": True}


@router.post("/expire-token")
def expire_token(user: dict = Depends(current_user)):
    accounts.expire_access_tokens(user["id"], db.company_id())
    return {"ok": True}


@router.post("/deactivate")
def deactivate(user: dict = Depends(current_user)):
    accounts.deactivate_member(user["id"])
    return {"ok": True}


@router.post("/bot/morning-summary")
def morning(user: dict = Depends(current_user)):
    bot.send_morning_summary(user["id"])
    return {"ok": True}


@router.post("/bot/evening-checkin")
def evening(user: dict = Depends(current_user)):
    bot.send_evening_checkin(user["id"])
    return {"ok": True}


@router.post("/bot/escalate")
def escalate(user: dict = Depends(current_user)):
    return {"escalated": bot.trigger_escalation(user["id"])}


@router.post("/pm/sync")
def pm_sync(user: dict = Depends(current_user)):
    enqueue("pm_sync", {}, dedupe_key=None)
    return {"queued": True}


@router.post("/pm/down")
def pm_down(body: dict, user: dict = Depends(current_user)):
    mock.set_down(bool(body.get("down")))
    return {"down": bool(body.get("down"))}


@router.get("/events")
def events(user: dict = Depends(current_user)):
    items = [e for targets, e in hub.recent if user["id"] in targets]
    return {"events": [{"type": e["type"]} | {k: v for k, v in e.items() if k in ("channelId", "userId")} for e in items[-50:]]}
