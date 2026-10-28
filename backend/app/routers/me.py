"""The signed-in person: profile, check-ins, activity, and the app's fixed settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import bot
from ..core import not_found, now_iso
from ..deps import current_user, language
from ..events import publish
from ..notify import public_activity
from ..rules import (
    DELETE_WINDOW_MS,
    EDIT_WINDOW_MS,
    PERCENT_STEPS,
    ROLES_IN_EVERY_CHANNEL,
    default_channel_names,
    localized,
)
from ..schemas import CheckinAnswer
from ..access import assert_project_active
from ..store import S, setup
from ..views import checkin_view, me_view

router = APIRouter(tags=["me"])


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return me_view(user)


@router.get("/company")
async def company():
    """The workspace's name, shown on the sign-in screen (so no token needed)."""
    c = S().company
    return {"id": c["id"], "name": c["name"]}


@router.get("/meta")
async def meta(user: dict = Depends(current_user), lang: str = Depends(language)):
    """The company's setup and fixed rules the app needs to lay out forms (it never decides them itself).
    Labels come in the reader's language."""
    st = setup()
    titles = [jt["name"] for jt in st["jobTitles"]]
    return {
        "stages": [{"key": x["key"], "label": localized(x["label"], lang)} for x in st["stages"]],
        "phases": st["phases"],
        "jobTitles": [{"name": jt["name"], "label": localized(jt.get("label", jt["name"]), lang),
                       "managersOnly": jt.get("managersOnly", False)} for jt in st["jobTitles"]],
        "defaultJobTitle": st["defaultJobTitle"],
        "problemTypes": [{"key": p["key"], "label": localized(p["label"], lang), "inCheckins": p.get("inCheckins", True)}
                         for p in st["problemTypes"]],
        "percentSteps": PERCENT_STEPS,
        "editWindowMs": EDIT_WINDOW_MS,
        "deleteWindowMs": DELETE_WINDOW_MS,
        "rolesInEveryChannel": ROLES_IN_EVERY_CHANNEL,
        "defaultChannels": {
            role: {jt: default_channel_names(st, role, jt) for jt in titles} for role in ("manager", "member")
        },
    }


@router.get("/me/checkins")
async def my_checkins(user: dict = Depends(current_user)):
    mine = sorted((c for c in S().checkins.values() if c["userId"] == user["id"]), key=lambda c: (c["askedAt"], c["id"]))
    return {"checkins": [checkin_view(c) for c in mine]}


@router.post("/checkins/{checkin_id}/answer")
async def answer_checkin(checkin_id: str, body: CheckinAnswer, user: dict = Depends(current_user)):
    s = S()
    c = s.checkins.get(checkin_id)
    if not c or c["userId"] != user["id"]:
        raise not_found("Check-in")
    if not c["answer"]:
        task = s.tasks.get(c["taskId"])
        assert_project_active(task["projectId"] if task else None)
        bot.apply_checkin_answer(c, body.model_dump(exclude_none=True))  # repeating it changes nothing
    return checkin_view(c)


@router.post("/bot/checkins")
async def ask_checkins(user: dict = Depends(current_user)):
    """The app calls this when the bot conversation opens."""
    return {"asked": bot.ask_about_open_tasks(user["id"])}


@router.get("/activity")
async def activity(user: dict = Depends(current_user)):
    mine = [a for a in S().activities if a["userId"] == user["id"]]
    mine.sort(key=lambda a: (a["createdAt"], a["id"]), reverse=True)
    return {"items": [public_activity(a) for a in mine[:100]], "unreadCount": sum(1 for a in mine if not a["readAt"])}


@router.post("/activity/read")
async def activity_read(user: dict = Depends(current_user)):
    ts = now_iso()
    for a in S().activities:
        if a["userId"] == user["id"] and not a["readAt"]:
            a["readAt"] = ts
    publish({"type": "activity.read"}, [user["id"]])
    return {"unreadCount": 0}
