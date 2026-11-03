"""The Cards API for a company's PM app (docs/CARDS_API.md): a bot that sends cards to people (each card to one
person's bot conversation, never a channel). Called with
the company's API key, never a person's session; the key decides the company and reaches nothing but cards.
HTTP only: the work is in services/cards.py and integrations.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse

from .. import db
from ..core import ApiError
from ..schemas import CardCreate, CardPatch
from ..services import cards, integrations

router = APIRouter(prefix="/api/v1", tags=["cards api"])

CALLS_PER_MINUTE = 120


def integration(authorization: str = Header(default="")) -> str:
    company_id = integrations.company_for_key(authorization.removeprefix("Bearer ").strip())
    if not integrations.count_call(company_id, CALLS_PER_MINUTE):
        raise ApiError("RATE_LIMITED", "Too many calls: 120 a minute per company.", {"retryAfter": 60})
    db.current().set_company(company_id)
    return company_id


# ---- Cards ----

@router.post("/cards")
def create_card(body: CardCreate, company_id: str = Depends(integration)):
    data = body.model_dump(mode="json", exclude_none=True)
    content = {k: data[k] for k in cards.CONTENT_KEYS if data.get(k) not in (None, [], {})}
    card, created = cards.create(ext_id=body.id, to=body.to, content=content, ref=body.ref,
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
