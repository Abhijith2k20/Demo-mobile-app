# Siteline Cards API — for the PM app

> **Version 1 (draft, 2026-11-02).** How a company's PM app uses Siteline to reach its people, the way a
> business system uses the WhatsApp Business API. **The PM app decides; Siteline delivers.** The PM app owns
> projects, tasks and every rule about chasing them: what to ask, when, reminders and escalation. Siteline
> shows the cards in its app, sends pushes, keeps answers made without signal, and sends every answer back to
> the PM app by webhook. Siteline has no copy of the PM app's tasks.

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

## 2. Projects and their people

The PM app tells Siteline which projects exist and who is on them. Siteline keeps a **project space** per
project: its standard channels (from the company's setup) and its members.

### `PUT /projects/{projectRef}`

Creates or updates the project space. `projectRef` is the PM app's project id. Repeating it is harmless.

```json
{
  "name": "Villa 99",
  "client": "Villa 99 owners",
  "address": "Bengaluru",
  "url": "https://pm.example.com/projects/77",
  "status": "active",
  "members": [
    {"ref": "amit@paliath.in", "role": "manager", "roleName": "Project Manager"},
    {"ref": "ravi@paliath.in", "role": "member", "roleName": "Worker"}
  ]
}
```

- `status`: `active` or `closed` (closed = the space becomes read-only, archived).
- `members` is the full list: people missing from it leave the project (their messages stay). `role` is
  `manager` or `member`; `roleName` is matched to the company's job titles in Siteline (unknown → the default
  job title), which decides their default channels. Guests added in Siteline are kept.
- Reply `200`: `{"project": {"id": "...", "ref": "77"}, "unmatched": ["newhire@paliath.in"]}`. `unmatched`
  lists refs that aren't on Siteline yet; the company's admins see them with an **Invite** button.

### `DELETE /projects/{projectRef}`

Same as `status: closed`.

## 3. Cards

A **card** is a message to one person in their Siteline Bot conversation, with buttons to answer.

### `POST /cards`

```json
{
  "id": "checkin-4411-2026-11-02",
  "to": "ravi@paliath.in",
  "project": "77",
  "title": {"en": "False ceiling – living room", "kn": "ಫಾಲ್ಸ್ ಸೀಲಿಂಗ್ – ಲಿವಿಂಗ್ ರೂಮ್"},
  "subtitle": {"en": "Villa 99 · due Wed 4 Nov"},
  "badge": {"text": {"en": "Overdue"}, "tone": "danger"},
  "fields": [{"label": {"en": "Now"}, "value": "50%"}],
  "scale": [
    {"id": "25", "label": "25%"}, {"id": "50", "label": "50%"}, {"id": "75", "label": "75%"},
    {"id": "90", "label": "90%"}, {"id": "done", "label": {"en": "Done", "hi": "पूरा"}}
  ],
  "scaleReached": "50",
  "buttons": [
    {"id": "problem", "label": {"en": "Problem"}, "choices": [
      {"id": "material", "label": {"en": "Material not arrived"}},
      {"id": "other", "label": {"en": "Other"}, "noteRequired": true}
    ]},
    {"id": "not_started", "label": {"en": "Not started"}}
  ],
  "note": {"text": true, "voice": true, "photo": true},
  "ref": {"task": "4411"},
  "push": {"title": {"en": "Siteline Bot"}, "body": {"en": "How is False ceiling – living room going?"}},
  "expiresAt": "2026-11-03T18:30:00Z"
}
```

- `id`: the PM app's own id for this card. **Sending the same id again returns the same card** (no second
  card, no second push), so retries are safe. Ids are per company.
- Text can be a plain string or `{"en": ..., "kn": ..., "hi": ...}`; Siteline shows the person's language and
  falls back to English.
- **Answer parts** (all optional; a card with none is just information, like a morning summary):
  - `scale`: a one-tap row (up to 6 stops). `scaleReached` shades the stops already reached.
  - `buttons`: up to 3 quiet buttons; a button with `choices` opens a list (up to 8) instead of answering.
    `noteRequired` makes the person write a note first.
  - `note`: lets the person add text, a voice note (up to 2 min) or a photo to their answer.
- `ref`: anything the PM app wants back in the webhook (for example the task id). Siteline doesn't read it.
- `push`: the notification. Left out = a push with the title. Siteline holds it during the person's quiet hours
  (the card itself shows at once).
- `expiresAt`: after this the card can't be answered and shows "Expired".
- Reply `201` (or `200` for a repeat): `{"card": {"id": "...", "state": "open"}}`.
- Refusals: `NOT_A_MEMBER` (unknown or deactivated ref), `NOT_FOUND` (unknown project), `VALIDATION_FAILED`.

Only one card is open at a time on the phone: the others wait as one-line rows ("Update") in the order sent.

### `PATCH /cards/{id}`

Changes a card that's still open: any field above, or close it.

```json
{"subtitle": {"en": "Villa 99 · due Fri 6 Nov"}, "fields": [{"label": {"en": "Now"}, "value": "60%"}]}
{"closed": true, "closedText": {"en": "Changed in the PM app"}}
```

The person's phone refreshes it at once. An answered card can't be changed (`409`).

### `POST /cards/{id}/nudge`

A reminder: one quiet line under the conversation ("Reminder: False ceiling still needs an update") and a
push. At most one nudge per card per hour (`429`).

### `GET /cards/{id}`

`{"card": {"id", "state": "open|answered|closed|expired", "seenAt", "answer"}}`, for the PM app to check.

## 4. Messages in project channels

### `POST /messages`

Posts a card or a line in a project channel, for status updates and escalations.

```json
{
  "id": "status-4411-2026-11-02",
  "project": "77",
  "channel": "site-work",
  "card": {
    "title": {"en": "Ravi · False ceiling – living room → 75%"},
    "lines": [{"en": "“Boards fixed, cove tomorrow”"}],
    "tone": "info",
    "photos": ["upl_..."]
  },
  "notify": {"managers": true, "people": ["amit@paliath.in"], "push": {"en": "Ravi hasn't updated False ceiling"}}
}
```

- `channel`: a channel name in the project; left out = the company's work channel (from its setup).
- `card.tone`: `info`, `success`, `warning` or `danger` (the colour of the card's edge).
- `card.photos`: upload ids from answers (see §5), so a status card can show the person's photo.
- `notify.managers`: an Activity item (and push) for the project's Managers; `people`: for these refs.
- Same `id` again = the same message.

## 5. Webhooks to the PM app

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
- File `url`s work for 7 days; `upload` ids can be reused in `POST /messages`.

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

## 6. What stays with the PM app

- Which tasks to ask about, when (working days, time zones, holidays), how often.
- Reminders (`nudge`) and escalation (`POST /messages` with `notify.managers`).
- What an answer means for the task (75% → in progress, Problem → blocked), and any status card it wants posted.
- Morning summaries: an information card (no answer parts) with one `fields` row per task.

## 7. What Siteline guarantees

- A card reaches only an active member of that company, in their language, in their Siteline Bot conversation.
- Answers made without signal are kept on the phone and delivered when it's back, in order, once.
- Every answer is delivered to the PM app at least once (check `X-Siteline-Id` to ignore repeats).
- Pushes respect each person's notification level and quiet hours.
- Nothing from one company is ever shown in another.
