"""Dev panel controls (spec §13). Only mounted outside production (config.DEV_TOOLS). Bot and account actions
apply to the signed-in person in their current company."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import config, db, netsim
from ..core import not_found
from ..deps import current_user
from ..events import hub
from ..mockpm import bot, data
from ..schemas import NetworkConfig
from ..services import accounts

router = APIRouter(prefix="/internal", tags=["dev"])


# Every route here needs a signed-in person, and outside local development one of the seeded demo accounts: staging
# is on the internet, and these change or wipe its data. Anyone else gets 404, as if the routes weren't there.
def demo_user(user: dict = Depends(current_user)) -> dict:
    if not config.DEVELOPMENT and not (user.get("email") or "").lower().endswith(config.TEST_ACCOUNTS):
        raise not_found()
    return user


@router.get("/state")
def state(user: dict = Depends(demo_user)):
    return {"network": netsim.state(),
            "connections": {k: len(v) for k, v in hub.conns.items()}}


@router.post("/reset")
def reset(user: dict = Depends(demo_user)):
    from ..seed import reset_everything

    # End this request's own transaction first: it holds locks from the sign-in check, and the wipe (TRUNCATE)
    # would wait on them forever.
    db.current().finish()
    reset_everything()
    return {"reset": True}


@router.post("/network")
def network(body: NetworkConfig, user: dict = Depends(demo_user)):
    netsim.configure(body.mode, body.inject)
    return netsim.state()


@router.post("/expire-token")
def expire_token(user: dict = Depends(demo_user)):
    accounts.expire_access_tokens(user["id"], db.company_id())
    return {"ok": True}


@router.post("/deactivate")
def deactivate(user: dict = Depends(demo_user)):
    accounts.deactivate_member(user["id"])
    return {"ok": True}


# The mock PM app's bot, for the signed-in person (spec §13).

@router.post("/bot/morning-summary")
def morning(user: dict = Depends(demo_user)):
    bot.morning_summary(bot.ref_of(user["id"]))
    return {"ok": True}


@router.post("/bot/evening-checkin")
def evening(user: dict = Depends(demo_user)):
    return {"asked": bot.checkin_now(bot.ref_of(user["id"]))}


@router.post("/pm/down")
def pm_down(body: dict, user: dict = Depends(demo_user)):
    data.set_down(bool(body.get("down")))
    return {"down": bool(body.get("down"))}
