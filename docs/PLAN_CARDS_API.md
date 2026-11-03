# Plan — the Cards API (spec 2.1, build step 8)

> **Status: built 2026-11-02** (steps 1–5 in one go; the emulator check in step 4 is still to do). The PM app takes over the bot's decisions; Siteline becomes the channel. The API the
> PM team builds against is `docs/CARDS_API.md`. Each step below ends with all checks passing and one commit,
> and the app keeps working after every step: the mock PM app takes over today's bot before the old code goes.

## 1. Cards in Siteline (no API yet)

- Migration: `cards` and `webhook_deliveries` tables; `pm_links` becomes `integrations` (API key hash,
  webhook URL, webhook secret, last call, last error).
- `services/cards.py`: create (idempotent by the PM app's id), update, close, expire, nudge, answer.
  Content is checked against limits (scale ≤ 6, buttons ≤ 3, choices ≤ 8, text sizes, languages).
- Message type `card`; `GET /me/cards`, `POST /cards/:id/answer`; events `card.new|updated`.
- `services/webhooks.py`: `card.answered` deliveries as jobs, signed, retried 1/5/15 min then hourly for 24 h;
  the reply's `result` sets the card's delivery state.
- Tests: idempotent create, wrong-company refs, answer once, delivery states, signature.

## 2. The Cards API

- `routers/integration_api.py` at `/api/v1`: key auth (hashed keys, per company, rotation with 24 h overlap),
  120 calls a minute per company; `PUT/DELETE /projects/{ref}` (project space and members, through
  `services/projects.py`), `POST /cards`, `PATCH /cards/{id}`, `POST /cards/{id}/nudge`, `GET /cards/{id}`,
  `POST /messages` (channel cards, `notify`).
- Platform panel: PM link with webhook URL; make or rotate the key and secret (shown once).
- Tests: every endpoint, keys of one company can't reach another, suspended company refused, limits.

## 3. The app draws cards from their content

- One `Card` renderer for `card` messages (and 2.0 `checkin` messages): title, subtitle, badge, fields, scale,
  buttons with choices, note; answered line; delivery state ("Sending to <PM app>…", "Not saved: …").
- The bot queue (one open at a time, progress bar) works on cards. Send queue item `card` replaces `checkin`
  (old queued check-in answers still send).
- "Related task" in Report issue lists tasks named in this project's recent cards.

## 4. The mock PM app takes over the bot

- `mockpm/`: today's planner, check-ins, reminders and morning summaries, rewritten to call the
  Cards API functions (the same ones the HTTP API uses) and to take `card.answered` through the same webhook
  delivery (an in-process target for kind `mock`). Its tasks and projects stay in `pm_mock_*` and the platform
  panel. It sends projects and members with `PUT /projects`.
- Seed: Paliath and Brightline linked to the mock PM app.
- Checked on the emulator: Ravi's card, answer, the mock PM app's status card and nudge.

## 5. Remove the 2.0 bot from Siteline

- Delete: `bot.py` planner and check-ins, `pm/connector.py`, `pm/sync.py`, `pm/http.py`, `pm_tasks`,
  `pm_events`, `checkins`, the webhook from the PM app, `rules.task_needs_update` / `pm_change_for` (they move to
  `mockpm/`), check-in times in setups, `POST /bot/checkins`.
- Docs: README, CLAUDE.md, DECISIONS.md; spec status.

## Not in this plan

- More than one integration per company.
- A form builder for cards on the platform panel.
