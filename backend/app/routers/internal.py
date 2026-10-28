"""Demo panel controls. Only mounted when SITELINE_DEMO is on (the default for this mock)."""
from __future__ import annotations

from fastapi import APIRouter

from .. import actors, bot, netsim
from ..core import not_found
from ..events import hub
from ..notify import flush_all
from ..schemas import ActorsConfig, AsUser, NetworkConfig
from ..store import S
from ..services.people import deactivate_user, expire_access_tokens

router = APIRouter(prefix="/internal", tags=["demo"])


def _user(user_id: str) -> dict:
    u = S().users.get(user_id)
    if not u:
        raise not_found("Person")
    return u


@router.get("/state")
async def state():
    return {"network": netsim.state(), "actorsPaused": actors.paused(), "connections": {k: len(v) for k, v in hub.conns.items()}}


@router.post("/reset")
async def reset():
    from ..main import reset_everything

    reset_everything()
    return {"reset": True}


@router.post("/network")
async def network(body: NetworkConfig):
    netsim.configure(body.mode, body.inject)
    return netsim.state()


@router.post("/actors")
async def set_actors(body: ActorsConfig):
    actors.set_paused(body.paused)
    return {"actorsPaused": actors.paused()}


@router.post("/actors/amit-shifts")
async def amit_shifts():
    actors.amit_shifts_tasks(0)
    return {"ok": True}


@router.post("/actors/rohan-posts")
async def rohan_posts():
    actors.rohan_posts_qs(0)
    return {"ok": True}


@router.post("/expire-token")
async def expire_token(body: AsUser):
    expire_access_tokens(_user(body.userId)["id"])
    return {"ok": True}


@router.post("/deactivate")
async def deactivate(body: AsUser):
    deactivate_user(_user(body.userId)["id"])
    return {"ok": True}


@router.post("/bot/morning-summary")
async def morning(body: AsUser):
    bot.send_morning_summary(_user(body.userId)["id"])
    return {"ok": True}


@router.post("/bot/evening-checkin")
async def evening(body: AsUser):
    bot.send_evening_checkin(_user(body.userId)["id"])
    return {"ok": True}


@router.post("/bot/escalate")
async def escalate(body: AsUser):
    return {"escalated": bot.trigger_escalation(_user(body.userId)["id"])}


@router.post("/notifications/flush")
async def flush():
    flush_all()
    return {"ok": True}


@router.get("/events")
async def events(userId: str | None = None):
    items = [e for targets, e in hub.recent if userId is None or userId in targets]
    return {"events": [{"type": e["type"]} | {k: v for k, v in e.items() if k in ("channelId", "userId")} for e in items[-50:]]}
