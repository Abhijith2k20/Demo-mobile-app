"""The signed-in person: profile, settings, push tokens, check-ins, activity, and the company's setup."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import bot, db
from ..core import not_found, now_iso
from ..deps import current_user
from ..events import publish
from ..notify import public_activity
from ..rules import (
    DELETE_WINDOW_MS,
    EDIT_WINDOW_MS,
    PERCENT_STEPS,
    ROLES_IN_EVERY_CHANNEL,
    default_channel_names,
)
from ..schemas import CheckinAnswer, MePatch, PushToken
from ..access import assert_project_active
from ..services import accounts
from ..store import company, human_ids, person, setup
from ..views import checkin_view, me_view, public_user

router = APIRouter(tags=["me"])


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return {**me_view(user), "notify": db.value("SELECT notify FROM users WHERE id = %(u)s", u=user["id"])}


@router.patch("/me")
def patch_me(body: MePatch, user: dict = Depends(current_user)):
    changes = body.model_dump(exclude_none=True)
    if changes:
        db.update("users", {"id": user["id"]}, {**changes, "updatedAt": now_iso()})
        if "name" in changes:
            publish({"type": "user.updated", "user": public_user(person(user["id"]))}, human_ids())
    return me(person(user["id"]))


@router.delete("/me")
def delete_me(user: dict = Depends(current_user)):
    """Delete my account (§9.8). Messages stay under "Former member"."""
    accounts.delete_account(user["id"])
    return {"deleted": True}


@router.put("/me/push-tokens")
def add_push_token(body: PushToken, user: dict = Depends(current_user)):
    db.run("""INSERT INTO push_tokens (token, user_id, platform) VALUES (%(t)s, %(u)s, %(p)s)
              ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = now()""",
           t=body.token, u=user["id"], p=body.platform)
    return {"saved": True}


@router.delete("/me/push-tokens/{token}")
def remove_push_token(token: str, user: dict = Depends(current_user)):
    db.run("DELETE FROM push_tokens WHERE token = %(t)s AND user_id = %(u)s", t=token, u=user["id"])
    return {"removed": True}


@router.get("/company")
def get_company(user: dict = Depends(current_user)):
    c = company()
    return {"id": c["id"], "name": c["name"]}


@router.get("/meta")
def meta(user: dict = Depends(current_user)):
    """The company's setup and fixed rules the app needs to lay out forms (it never decides them itself)."""
    st = setup()
    titles = [jt["name"] for jt in st["jobTitles"]]
    return {
        "jobTitles": [{"name": jt["name"], "label": jt["name"], "managersOnly": jt.get("managersOnly", False)}
                      for jt in st["jobTitles"]],
        "defaultJobTitle": st["defaultJobTitle"],
        "problemTypes": [{"key": p["key"], "label": p["key"], "inCheckins": p.get("inCheckins", True)}
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
def my_checkins(user: dict = Depends(current_user)):
    mine = db.rows("SELECT * FROM checkins WHERE user_id = %(u)s ORDER BY asked_at, id", u=user["id"])
    return {"checkins": [checkin_view(c) for c in mine]}


@router.post("/checkins/{checkin_id}/answer")
def answer_checkin(checkin_id: str, body: CheckinAnswer, user: dict = Depends(current_user)):
    c = db.row("SELECT * FROM checkins WHERE id = %(id)s", id=checkin_id)
    if not c or c["userId"] != user["id"]:
        raise not_found("Check-in")
    if not c["answer"]:
        assert_project_active(c["projectId"])
        c = bot.apply_checkin_answer(c, body.model_dump(exclude_none=True))  # repeating it changes nothing
    return checkin_view(c)


@router.post("/bot/checkins")
def ask_checkins(user: dict = Depends(current_user)):
    """The app calls this when the bot conversation opens."""
    return {"asked": bot.ask_about_open_tasks(user["id"])}


@router.get("/activity")
def activity(user: dict = Depends(current_user)):
    mine = db.rows("SELECT * FROM activities WHERE user_id = %(u)s ORDER BY created_at DESC, id DESC LIMIT 100", u=user["id"])
    unread = db.value("SELECT count(*) FROM activities WHERE user_id = %(u)s AND read_at IS NULL", u=user["id"])
    return {"items": [public_activity(a) for a in mine], "unreadCount": unread}


@router.post("/activity/read")
def activity_read(user: dict = Depends(current_user)):
    db.run("UPDATE activities SET read_at = now() WHERE user_id = %(u)s AND read_at IS NULL", u=user["id"])
    publish({"type": "activity.read"}, [user["id"]])
    return {"unreadCount": 0}
