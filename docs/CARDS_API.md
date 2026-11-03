# Siteline Cards API — for the PM app

> **Version 2 (draft, 2026-11-03).** How a company's PM app uses Siteline to reach its people, the way a
> business system uses the WhatsApp Business API. **The PM app decides; Siteline delivers.** The PM app owns
> projects, tasks and every rule about chasing them: what to ask, when, and reminders. Siteline shows the
> cards in the person's Siteline Bot conversation, sends pushes, keeps answers made without signal, and sends
> every answer back to the PM app by webhook.
>
> **The API is a bot that sends cards to people.** Send to anyone in the company, any time, as many as you like
> (within the rate limit); each card goes to one person's private Siteline Bot conversation, never to a group or
> channel. The API has no access to Siteline's projects, channels or
> messages; those are the company's own conversations. (Version 1 also had `PUT /projects` and `POST /messages`;
> both are gone.)

---

## 1. Connecting

- The Siteline team links a company to its PM app on the platform panel. Siteline then shows **once**:
  - an **API key** (`sk_live_…`) for the PM app to call Siteline; it belongs to that company only, and every
    call with it acts in that company;
  - a **webhook secret** to check that webhooks really come from Siteline.
  The PM app gives Siteline its **webhook URL**. Keys can be rotated on the panel; the old one keeps working for
  24 hours.
- Base URL: `https://api.siteline.app/api/v1` (staging: `https://staging-api.siteline.app/api/v1`).
- Every call: `Authorization: Bearer <api key>`, JSON in and out, the standard Siteline error format:
  `{"error": {"code": "NOT_A_MEMBER", "message": "...", "details": {}, "request_id": "req_..."}}`.
- **Limits:** 120 calls a minute per company (`429 RATE_LIMITED` with `Retry-After`).
- **People** are named by **ref**: their work email or phone (E.164, `+919800000005`), the same one they sign in
  to Siteline with. A ref Siteline doesn't know in this company is refused with `NOT_A_MEMBER`, so a card never
  reaches the wrong person.

## 2. Cards

A **card** is a message to one person in their Siteline Bot conversation, with buttons to answer.

### `POST /cards`

```json
{
  "id": "checkin-4411-2026-11-02",
  "to": "ravi@paliath.in",
  "title": "False ceiling – living room",
  "subtitle": "Villa 99 · due Wed 4 Nov",
  "badge": {"text": "Overdue", "tone": "danger"},
  "fields": [{"label": "Now", "value": "50%"}],
  "scale": [
    {"id": "25", "label": "25%"}, {"id": "50", "label": "50%"}, {"id": "75", "label": "75%"},
    {"id": "90", "label": "90%"}, {"id": "done", "label": "Done"}
  ],
  "scaleReached": "50",
  "buttons": [
    {"id": "problem", "label": "Problem", "choices": [
      {"id": "material", "label": "Material not arrived"},
      {"id": "other", "label": "Other", "noteRequired": true}
    ]},
    {"id": "not_started", "label": "Not started"}
  ],
  "note": {"text": true, "voice": true, "photo": true},
  "ref": {"task": "4411"},
  "push": {"title": "Siteline Bot", "body": "How is False ceiling – living room going?"},
  "expiresAt": "2026-11-03T18:30:00Z"
}
```

- `id`: the PM app's own id for this card. **Sending the same id again returns the same card** (no second
  card, no second push), so retries are safe. Ids are per company.
- All text is plain strings (English for now).
- **Answer parts** (all optional; a card with none is just information, like a morning summary):
  - `scale`: a one-tap row (up to 6 stops). `scaleReached` shades the stops already reached.
  - `buttons`: up to 3 quiet buttons; a button with `choices` opens a list (up to 8) instead of answering.
    `noteRequired` makes the person write a note first.
  - `note`: lets the person add text, a voice note (up to 2 min) or a photo to their answer.
- `ref`: anything the PM app wants back in the webhook (for example the task id). Siteline doesn't read it.
- `push`: the notification. Left out = a push with the title.
- `expiresAt`: after this the card can't be answered and shows "Expired".
- Reply `201` (or `200` for a repeat): `{"card": {"id": "...", "state": "open"}}`.
- Refusals: `NOT_A_MEMBER` (unknown or deactivated ref), `VALIDATION_FAILED`.

Only one card is open at a time on the phone: the others wait as one-line rows ("Update") in the order sent.

### `PATCH /cards/{id}`

Changes a card that's still open: any field above, or close it.

```json
{"subtitle": "Villa 99 · due Fri 6 Nov", "fields": [{"label": "Now", "value": "60%"}]}
{"closed": true, "closedText": "Changed in the PM app"}
```

The person's phone refreshes it at once. An answered card can't be changed (`409`).

### `POST /cards/{id}/nudge`

A reminder: one quiet line under the conversation ("Reminder: False ceiling still needs an update") and a
push. At most one nudge per card per hour (`429`).

### `GET /cards/{id}`

`{"card": {"id", "state": "open|answered|closed|expired", "seenAt", "answer"}}`, for the PM app to check.

## 3. Webhooks to the PM app

Siteline sends `POST <webhook URL>` with:

```
Content-Type: application/json
X-Siteline-Event: card.answered
X-Siteline-Id: evt_01JD...            (the same for every retry of this event)
X-Siteline-Timestamp: 1793612345
X-Siteline-Signature: hex(HMAC-SHA256(secret, "<timestamp>.<body>"))
```

The PM app should check the signature and that the timestamp is within 5 minutes, and ignore an
`X-Siteline-Id` it has seen.

### `card.answered`

```json
{
  "card": "checkin-4411-2026-11-02",
  "ref": {"task": "4411"},
  "person": "ravi@paliath.in",
  "answer": {"scale": "75"},
  "note": {"text": "Boards fixed, cove tomorrow", "voice": {"url": "https://...", "seconds": 14, "upload": "upl_..."}, "photos": [{"url": "https://...", "upload": "upl_..."}]},
  "answeredAt": "2026-11-02T12:34:10Z",
  "receivedAt": "2026-11-02T12:51:02Z"
}
```

- `answer` is one of `{"scale": "<stop id>"}`, `{"button": "<id>"}` or `{"button": "<id>", "choice": "<id>"}`.
- `answeredAt` is when the person tapped (they may have had no signal); `receivedAt` is when it reached Siteline.
- File `url`s work for 7 days.

**The reply decides what the person sees:**
- `2xx` with `{"result": "accepted"}` (or an empty body): the card shows the answer as saved.
- `2xx` with `{"result": "refused", "message": "This task is already closed"}`: the card shows "Not saved: This
  task is already closed". No retries.
- Anything else, or no reply in 10 s: Siteline retries after 1, 5 and 15 minutes, then hourly for 24 hours; the
  card shows "Sending to <PM app>…" meanwhile. After 24 hours it shows "Couldn't reach <PM app>" and the
  company's admins are told.

### `card.seen` (optional)

Sent the first time the person opens a card: `{"card", "ref", "person", "seenAt"}`. Turned on per company.

### `person.joined` / `person.left`

When someone joins or leaves the company on Siteline: `{"person": "ravi@paliath.in", "name": "Ravi Kumar"}`,
so the PM app knows who it can send cards to.

## 4. What stays with the PM app

- Which tasks to ask about, when (working days, time zones, holidays), how often.
- Reminders (`nudge`).
- What an answer means for the task (75% → in progress, Problem → blocked), and any follow-up card (for example
  to the person's manager).
- Morning summaries: an information card (no answer parts) with one `fields` row per task.

## 5. What Siteline guarantees

- A card reaches only an active member of that company, in their Siteline Bot conversation.
- Answers made without signal are kept on the phone and delivered when it's back, in order, once.
- Every answer is delivered to the PM app at least once (check `X-Siteline-Id` to ignore repeats).
- Pushes respect each person's notification level.
- Nothing from one company is ever shown in another.
