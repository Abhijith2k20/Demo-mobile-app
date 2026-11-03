"""Dev panel controls (spec §13). Only mounted outside production (config.DEV_TOOLS). Bot and account actions
apply to the signed-in person in their current company."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db, netsim
from ..deps import current_user
from ..events import hub
from ..mockpm import bot, data
from ..schemas import NetworkConfig
from ..services import accounts

router = APIRouter(prefix="/internal", tags=["dev"])


@router.get("/state")
def state():
    return {"network": netsim.state(),
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


@router.post("/expire-token")
def expire_token(user: dict = Depends(current_user)):
    accounts.expire_access_tokens(user["id"], db.company_id())
    return {"ok": True}


@router.post("/deactivate")
def deactivate(user: dict = Depends(current_user)):
    accounts.deactivate_member(user["id"])
    return {"ok": True}


# The mock PM app's bot, for the signed-in person (spec §13).

@router.post("/bot/morning-summary")
def morning(user: dict = Depends(current_user)):
    bot.morning_summary(bot.ref_of(user["id"]))
    return {"ok": True}


@router.post("/bot/evening-checkin")
def evening(user: dict = Depends(current_user)):
    return {"asked": bot.checkin_now(bot.ref_of(user["id"]))}


@router.post("/pm/down")
def pm_down(body: dict, user: dict = Depends(current_user)):
    data.set_down(bool(body.get("down")))
    return {"down": bool(body.get("down"))}


@router.get("/events")
def events(user: dict = Depends(current_user)):
    items = [e for targets, e in hub.recent if user["id"] in targets]
    return {"events": [{"type": e["type"]} | {k: v for k, v in e.items() if k in ("channelId", "userId")} for e in items[-50:]]}
