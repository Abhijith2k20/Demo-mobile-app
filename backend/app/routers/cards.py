"""The PM app's cards, for the person they were sent to (spec §8): list, answer, mark seen."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db
from ..deps import current_user
from ..schemas import CardAnswer
from ..services import cards

router = APIRouter(tags=["cards"])


@router.get("/me/cards")
def my_cards(user: dict = Depends(current_user)):
    mine = db.rows("SELECT * FROM cards WHERE user_id = %(u)s ORDER BY created_at, id", u=user["id"])
    return {"cards": [cards.card_view(c) for c in mine]}


@router.post("/cards/{card_id}/answer")
def answer_card(card_id: str, body: CardAnswer, user: dict = Depends(current_user)):
    return cards.card_view(cards.answer(user, card_id, body.model_dump(mode="json")))


@router.post("/cards/{card_id}/seen")
def card_seen(card_id: str, user: dict = Depends(current_user)):
    cards.mark_seen(user, card_id)
    return {"seen": True}
