"""The Cards API for a company's PM app (docs/CARDS_API.md). Called with the company's API key, never a person's
session; the key decides the company. HTTP only: the work is in services/cards.py, projects.py, integrations.py."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse

from .. import db
from ..core import ApiError
from ..schemas import CardCreate, CardPatch, ChannelMessageCreate, PmProject
from ..services import cards, integrations
from ..services import projects as spaces

router = APIRouter(prefix="/api/v1", tags=["cards api"])

CALLS_PER_MINUTE = 120
# shortcut: counted per API process; with several API processes, move the count to Postgres.
_calls: dict[str, deque] = defaultdict(deque)


def integration(authorization: str = Header(default="")) -> str:
    company_id = integrations.company_for_key(authorization.removeprefix("Bearer ").strip())
    window = _calls[company_id]
    now = time.monotonic()
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= CALLS_PER_MINUTE:
        raise ApiError("RATE_LIMITED", "Too many calls: 120 a minute per company.", {"retryAfter": 60})
    window.append(now)
    db.current().set_company(company_id)
    return company_id


# ---- Projects ----

@router.put("/projects/{ref}")
def put_project(ref: str, body: PmProject, company_id: str = Depends(integration)):
    space, unmatched = spaces.apply_pm_project(ref, body.model_dump())
    integrations.remember_unmatched(ref, unmatched)
    return {"project": {"id": space["id"], "ref": ref} if space else None, "unmatched": unmatched}


@router.delete("/projects/{ref}")
def close_project(ref: str, company_id: str = Depends(integration)):
    existing = db.row("SELECT * FROM projects WHERE pm_project_id = %(r)s", r=ref)
    if existing:
        spaces.apply_pm_project(ref, {"name": existing["name"], "client": existing["client"], "address": existing["address"],
                                      "url": existing["pmUrl"], "status": "closed", "members": None})
    return {"closed": True}


# ---- Cards ----

@router.post("/cards")
def create_card(body: CardCreate, company_id: str = Depends(integration)):
    data = body.model_dump(mode="json", exclude_none=True)
    content = {k: data[k] for k in cards.CONTENT_KEYS if data.get(k) not in (None, [], {})}
    card, created = cards.create(ext_id=body.id, to=body.to, project_ref=body.project, content=content, ref=body.ref,
                                 expires_at=data.get("expiresAt"))
    return JSONResponse({"card": {"id": card["extId"], "state": cards.state(card)}}, status_code=201 if created else 200)


@router.patch("/cards/{card_id}")
def patch_card(card_id: str, body: CardPatch, company_id: str = Depends(integration)):
    card = cards.update(card_id, body.model_dump(mode="json", exclude_unset=True))
    return {"card": {"id": card["extId"], "state": cards.state(card)}}


@router.post("/cards/{card_id}/nudge")
def nudge_card(card_id: str, company_id: str = Depends(integration)):
    card = cards.nudge(card_id)
    return {"card": {"id": card["extId"], "state": cards.state(card)}}


@router.get("/cards/{card_id}")
def get_card(card_id: str, company_id: str = Depends(integration)):
    card = cards.by_ext_id(card_id)
    if not card:
        raise ApiError("NOT_FOUND", "Card not found.")
    return {"card": {"id": card["extId"], "state": cards.state(card), "seenAt": card["seenAt"],
                     "answer": card["answer"], "answeredAt": card["answeredAt"], "delivery": card["delivery"]}}


# ---- Channel messages ----

@router.post("/messages")
def post_message(body: ChannelMessageCreate, company_id: str = Depends(integration)):
    m = integrations.post_channel_message(ext_id=body.id, project_ref=body.project, channel=body.channel,
                                          card=body.card.model_dump(), notify=body.notify.model_dump() if body.notify else None)
    return {"message": {"id": m["id"]}}
