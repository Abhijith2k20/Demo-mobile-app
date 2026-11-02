# Siteline — MVP Spec

> **Version 2.1 — the PM app owns the bot (2026-11-02).** Siteline is a multi-company **work chat** that also
> **delivers cards for the company's project-management (PM) app**, the way WhatsApp delivers messages for a
> business: the PM app decides what to ask, whom, and when; Siteline shows the card, keeps answers made without
> signal, and sends every answer back by webhook. Projects and tasks live only in the PM app. Companies are
> created by the Siteline team. Sign-in is a one-time code by email or SMS. The app ships as real builds (EAS).
> The API for the PM team is `docs/CARDS_API.md`.
>
> Version 2.0 had Siteline's own bot reading the PM app's tasks and deciding when to ask; 2.1 moves those
> decisions to the PM app (`DECISIONS.md`, "The PM app owns the bot").
>
> **Status:** steps 1–7 of §15 are built as 2.0; step 8 (the Cards API, this version) is next; step 9 (launch)
> needs the accounts listed in the README. `DECISIONS.md` says where the build differs.

---

## 0. What the MVP must deliver

1. **Work chat for field teams:** a Slack-style workspace per company: project channels, company channels, DMs,
   threads, photos, voice notes, files, simple enough for site workers, in English, Kannada and Hindi.
2. **Cards from the PM app:** the PM app sends a person a **card** (for example "How far is False ceiling?"
   with a one-tap scale), reminds, and posts status and escalation cards in project channels, all through the
   **Cards API**. Siteline delivers them in the person's Siteline Bot conversation, with push, and sends each
   answer back to the PM app. The PM app owns every rule about what to ask and when.
3. **Many companies, fully separated:** each company is a tenant. Nothing from one company is ever visible to
   another. One person can belong to several companies and switch between them.
4. **Ready to run for real customers:** data in Postgres with backups, real sign-in codes, push notifications,
   file storage, error tracking, staging and production, store builds.
5. **Any industry:** no industry words in code. Each company has a **setup** (job titles, project channels,
   problem types, the work channel, labels per language), copied from an industry template when the company is
   created. Card wording comes from the PM app.

**Thin client, as before:** every rule, permission and calculation lives on the server. The app shows what the
server returns (`access.permissions`, `can*` flags, computed fields) and never works results out itself.

### 0.1 Project management removed from Siteline

Everything below exists in the demo and is **deleted** in the MVP (build step 2, §15; order in `docs/PLAN_REMOVE_PROJECT_MANAGEMENT.md`). The PM app does it now.

| Where | Removed |
|---|---|
| Tabs and routes | **My tasks** tab (`tasks.tsx`), task detail (`task/[id].tsx`), the **Tasks** segment of a project |
| Project screens | Stage stepper and "Move to next stage", stage pill, stage banner, key dates card, progress ring, "days behind" |
| Schedule | Task list grouped by phase, filters (Mine, Pending, owner, due, behind, phase), quick add, swipe to done or shift dates |
| Task features | Creating, editing and assigning tasks; dates and date shifting; baseline lock and re-baseline; variance; "done, awaiting confirmation"; task history |
| Chat | **New task** form, "Create task from message", **task cards** (`task_card`), task-change Activity items and their 10 s batching |
| Company setup | `stages`, `phases`; Home's delay indicator |
| Server | `routers/tasks.py` and every `/tasks`, `/me/tasks`, `/projects/:id/tasks` (write), `/task-defaults`, `/baseline/*` route; task rules in `rules.py` (filters, defaults, phases, stages, delay, progress); `services/tasks.py`; view fields `delayDays`, `progress`, `nextStage`, `varianceDays`, `isLate`, `isDelayed`; task events `task.created|updated`; the "shift 5 tasks" scripted teammate; their tests |
| App | the `tasks` feature folder, task filters and their tests, task translations, the stage colours |

**Kept:** the Siteline Bot conversation (now showing the PM app's cards), status cards, issue and daily report
cards, project spaces with channels and members, files, Activity for mentions, replies and the PM app's
notifications.

**Expected load at launch** (design for it, prove 10× in a load test): up to 50 companies, 2,000 people, 300
online at once, 50,000 messages and 5,000 cards a day.

---

## 1. Hard constraints

- **Development builds, not Expo Go.** The app uses native modules (push, audio, secure storage). Develop with
  an EAS development build; ship with EAS Build. Add native libraries only with `npx expo install`; configure
  native behaviour in `app.config.ts` and config plugins, never by editing `ios/` or `android/`.
- **TypeScript strict mode.** No `any`.
- **Android first** (mid/low-end phones; smooth scrolling is a requirement). iOS builds through TestFlight, with
  no iOS-only features.
- **Light and dark mode**, following the system setting.
- **Works on a bad connection:** the last loaded screens show offline; site actions (messages, photos, card
  answers) wait in the send queue (§12.4).
- **No borrowed branding:** Slack-like layout and density, but not Slack's logo, name, purple, icons or copy.
- **The PM app is the source of truth for projects and tasks, and decides what the bot asks.** Siteline keeps
  no copy of tasks and has no rules about them; it delivers cards and answers (§8, §9.3).

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| App | Expo SDK 57, React Native, TypeScript, `expo-router` |
| Builds and updates | EAS Build (profiles `development`, `preview` → staging, `production`), EAS Update (channel per profile) |
| Server data in the app | `@tanstack/react-query`; live events mark queries stale |
| App-only state | `zustand` |
| Lists | `@shopify/flash-list` v2 |
| Sheets | own `Sheet` component (`src/components/Sheet.tsx`) |
| Forms | `react-hook-form` + `zod` |
| Images | `expo-image`, `expo-image-picker`, `expo-image-manipulator` (resize before upload) |
| Voice notes, files | `expo-audio`, `expo-document-picker` |
| Push | `expo-notifications` through Expo's push service |
| Sign-in storage | `expo-secure-store` |
| i18n | `i18next` + `react-i18next` (English full; Kannada and Hindi for the site-worker flow) |
| Icons, fonts | `@expo/vector-icons` (Feather only), `@expo-google-fonts/inter` |
| Backend | Python 3.13, FastAPI, Pydantic, uvicorn |
| Database | Postgres 16, SQLAlchemy 2 (async), Alembic migrations, row-level security (§10.4) |
| Background work | a `jobs` table in Postgres and one worker process (§10.6) |
| Live events | WebSocket on the API; Postgres `LISTEN/NOTIFY` carries events from the worker to the API (§10.7) |
| Files | Cloudflare R2 (S3 API), private bucket, short-lived signed links |
| Email / SMS codes | Resend (email), MSG91 (SMS, DLT-registered template), behind one `senders/` interface |
| Errors | Sentry (app and backend) |
| Hosting | Render, Singapore region: API service, worker service, managed Postgres with daily backups and point-in-time recovery |
| CI | GitHub Actions: lint, typecheck, jest, pytest (against Postgres) on every push; deploy staging on merge to `main`; production by hand |
| Tests | app: `jest` + `jest-expo`; backend: `pytest` (rules, permissions, every route, tenant isolation, jobs) |

---

## 3. Design language

Unchanged from the demo except where noted: stage pills, the stage banner and stage colours are **removed**
(stages belong to the PM app).

### 3.1 Direction

Information architecture and density inspired by Slack mobile: a workspace home of collapsible sections,
compact channel rows bold when unread, left-aligned message rows (avatar, name, time, text, not bubbles),
threads, and block-style cards in the message stream.

Visual style: neutral work-chat. White surfaces, grey hairlines and near-black text in light mode; charcoal in
dark mode; one blue accent; a dark blue-grey workspace header. Status colours are muted: colour marks state, it
does not decorate. Generous touch targets for site workers.

### 3.2 Colour tokens

Defined in `src/theme/colors.ts` with light and dark values. Never hard-code colours.

| Token | Light | Dark | Use |
|---|---|---|---|
| `header` | `#1B2430` | `#121417` | Workspace header, sign-in header |
| `onHeader` | `#FFFFFF` | `#F2F3F4` | Text/icons on header |
| `headerField` | `#2A3442` | `#22262B` | Search field inside the header |
| `bg` | `#FFFFFF` | `#1A1D21` | App background |
| `surface` | `#FFFFFF` | `#222529` | Cards, sheets, rows |
| `surfaceAlt` | `#F4F5F6` | `#2C2F33` | Section headers, inputs, pressed rows |
| `border` | `#E2E4E7` | `#35373B` | Hairlines (1 px) |
| `text` | `#1D1C1D` | `#D1D2D3` | Primary text |
| `textMuted` | `#616061` | `#A3A5A8` | Secondary text, timestamps |
| `textFaint` | `#6E7074` | `#979A9E` | Placeholders, hints (≥4.5:1 on its surfaces) |
| `accent` | `#1667B0` | `#4A9FE0` | Primary buttons, unread badges, links, active states |
| `accentSoft` | `#E8F1F9` | `#1B2E40` | Selected chip, mention highlight |
| `onAccent` | `#FFFFFF` | `#0E1A26` | Text/icons on accent |
| `onColor` | `#FFFFFF` | `#FFFFFF` | Text on avatars and photo overlays |
| `success` / `successSoft` | `#2A7253` / `#E6F2EC` | `#5FB58C` / `#1B2F26` | Done, sent, on track |
| `warning` / `warningSoft` | `#87600F` / `#FBF2DE` | `#D6A64F` / `#332A17` | Waiting, retrying, offline banner |
| `danger` / `dangerSoft` | `#B8423A` / `#FBEAE8` | `#E0736A` / `#38201E` | Failed, overdue, destructive |
| `info` / `infoSoft` | `#2F6F99` / `#E6F0F6` | `#6FA9CC` / `#1A2A35` | Sending state, neutral notices |
| `scrim` | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.6)` | Behind sheets |

**Avatar colours:** 8 muted earthy tones, picked from the user ID. Initials in white, 600 weight.

### 3.3 Typography (Inter)

| Style | Size / line height | Weight | Use |
|---|---|---|---|
| `title` | 20 / 26 | 700 | Screen titles, workspace name |
| `heading` | 17 / 22 | 600 | Channel name in header, card titles |
| `body` | 16 / 23 | 400 | Messages, inputs |
| `bodyStrong` | 16 / 23 | 600 | Sender names, unread channel names |
| `meta` | 13 / 18 | 400 | Timestamps, subtitles |
| `metaStrong` | 13 / 18 | 600 | Chips, small emphasis |
| `label` | 12 / 16 | 600, uppercase, +0.6 | Section headers, field labels |
| `button` | 16 / 22 | 600 | Button labels |

**Simple mode** (job titles the company marks `simpleMode`) bumps `body` to 17 and buttons to 18.

### 3.4 Spacing, shape, elevation, motion, icons

- 4-pt grid: `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32`. Screen side padding 16.
- Radii: inputs/buttons 10, cards 14, sheets 20 (top), pills 999, avatars 8 (rounded square).
- Almost flat: cards use a 1 px border; only sheets get a soft shadow.
- Touch targets 44 × 44 minimum, 48 × 48 for card buttons.
- 150–220 ms ease-out; new message fades in with an 8 px slide; respect "reduce motion".
- Feather icons, 20 px in rows, 22 px in headers. `#` glyph for public channels, `lock` for private.

### 3.5 Signature details

- **Workspace header:** company tile (initials), company name with a chevron that opens the **company
  switcher** when the person belongs to more than one company, and a "Jump to…" search field.
- **Message grouping** (same sender within 5 min), day dividers, an accent **"New"** divider.
- **Photo grids** like a site log: 1 full-width, 2 side by side, 3–4 in 2 × 2, more shows "+N".
- **Cards in chat** (issue, daily report, status) are structured blocks with a left accent rule. **Check-in
  cards** have their own layout (§8).

---

## 4. Navigation

```
app/                          ROUTES ONLY: read URL params, render a screen from src/features/<area>/screens/
  _layout.tsx                 providers, theme, fonts, auth gate, push setup
  (auth)/
    login.tsx                 → auth/LoginScreen (email or phone)
    otp.tsx                   → auth/OtpScreen
    companies.tsx             → auth/CompanyPickerScreen (invites to accept, companies to open)
  (app)/
    _layout.tsx               bottom tabs
    index.tsx                 → home/HomeScreen
    dms.tsx                   → chat/DmsScreen
    activity.tsx              → activity/ActivityScreen
    you.tsx                   → profile/YouScreen
  channel/[id].tsx            → chat/ChannelScreen
  thread/[messageId].tsx      → chat/ThreadScreen
  dm/[userId].tsx             → chat/DmScreen (`/dm/bot` is the Siteline Bot)
  project/[id]/index.tsx      → projects/ProjectScreen (Info, Members, Files)
  project/[id]/settings.tsx   → projects/ProjectSettingsScreen
  people.tsx                  → people/PeopleScreen
  invites.tsx                 → people/InvitesScreen (Owner/Admin)
  integration.tsx             → people/IntegrationScreen (Owner/Admin: PM link status)
  unsent.tsx                  → unsent/UnsentScreen
  dev.tsx                     → dev/DevPanelScreen (development and preview builds only)
```

**Bottom tabs:** Home, DMs, Activity, You — the same for every role. The **My tasks** tab is removed; the bot's
morning summary lists a person's tasks (§8).

**Deep links** (`siteline://`, and `https://<app-domain>/...` app links): `channel/:id`, `dm/:userId`,
`thread/:messageId`, `dm/bot`, `invites`. Push notifications open these. A link for another company switches to
it first if the person is a member, otherwise shows "You don't have access to this".

---

## 5. Screens

### 5.1 Sign in

One layout (`AuthShell`): dark header with the Siteline mark, a rounded card holding the form.

- **Login:** one field, **"Work email or phone number"**. Starts with a digit or `+` → phone (default country
  `+91`, shown as a prefix; stored as E.164); otherwise email. **Continue** sends a code (§9.6). Help line:
  "Can't sign in? Ask your company admin to invite you."
- **Code:** six boxes fed by one hidden input (paste and SMS autofill work), the address with **Change**,
  "Resend in 0:30" then **Resend code**. Signs in on the sixth digit. Errors from `OTP_INVALID`, `OTP_EXPIRED`,
  `OTP_TOO_MANY_ATTEMPTS`, `RATE_LIMITED`.
- **After the code:**
  - pending invites → **"Paliath Interiors invited you"** with **Join** / **Not now** (one row per invite);
  - exactly one company → open it;
  - several → **company picker** (name, tile, unread count); the last used one is remembered;
  - none and no invites → "You're not in a company on Siteline yet. Ask your admin to invite
    *ravi@example.com*." with **Use a different email or phone**.
- **Join** on an invite creates the membership; first sign-in asks for **your name** (pre-filled from the
  invite) and **language**.

### 5.2 Home (workspace)

1. **Workspace header** (§3.5) with the company switcher.
2. **Offline banner** when the server can't be reached.
3. **Sections** (collapsible, remembered per company):
   - **PROJECTS:** one row per active project space the person can see (bold if unread). Expanded: its channels
     (standard channels in setup order, then custom ones by name), unread badges, and a **Project info** row.
   - **Archived (N)** when there are archived projects.
   - **COMPANY:** `#announcements` (admins post), `#general`.
4. **New project** button, Owner/Admin only, and only for companies without a PM link (linked companies get
   their projects from the PM app, §9.3).

Pull-to-refresh refetches. Rows are 44 px.

### 5.3 Channel, 5.4 Thread, 5.5 Direct message

As in the demo, without the stage banner:
- Header: back, `# site-work`, "Villa 99 · 6 members", channel details (members, pinned, settings or leave).
- Message rows, long-press menu: React, Reply in thread, Copy text, Edit (own, ≤15 min), Delete (own ≤1 h;
  Managers any), Pin (Managers). **"Create task from message" is removed.**
- Composer with **"+"**: Camera, Gallery, **Voice note** (real recording, up to 2 min), **File** (PDF and
  images, up to 25 MB), **Report issue**, **Daily report**. Simple mode adds a large camera button.
- Read-only channels and archived projects show a muted bar instead of the composer.
- Messages are marked read only while the channel is on screen and the app is in the foreground.
- A new DM exists only on the phone until its first message.

### 5.6 Project info (`project/[id]`)

Segmented: **Info · Members · Files**.
- **Info:** name, client and address (from the PM app), **"Open in <PM app name>"** (link from the PM app),
  "Channels" with **Browse channels**, **Project settings** for Managers, "Recent updates" (last 5 status
  cards). Archived projects show a read-only banner.
- **Members:** avatar, name, Manager/Member badge, job title, channels, and a **from PM** or **guest** label.
- **Files:** every photo and file from the project's channels the viewer can read, newest first.

### 5.7 Bot DM

The PM app's cards (§8).

### 5.8 Activity

Mentions, thread replies and the PM app's notifications (status and escalation cards it flags for someone),
newest first; unread items have an accent rule.

### 5.9 You

- Avatar, name (editable), email, phone, language (English / ಕನ್ನಡ / हिंदी; saved on the server, so cards and
  pushes show in it), theme.
- **Company:** current company with **Switch company** (when more than one); **People**; for Owner/Admin
  **Invites** and **PM link** (status, §9.3).
- **Notifications:** All · Important (DMs, mentions, cards) · Off. Plus quiet hours (21:00–07:00, company
  time zone); card pushes wait until they end.
- **Unsent items**, **Log out** (warns if the queue has items), **Delete my account** (asks first, §9.8).

### 5.10 People (`people.tsx`)

Directory of the current company (guests don't see it). Search by name, email or phone. Tap a person: role,
projects you share, **Message**; Owner/Admin get **Change role** and **Deactivate**. Deactivated people are
listed separately.

### 5.11 Invites (`invites.tsx`, Owner/Admin)

- **Invite person:** name, email or phone, role (Admin — Owner only; Member; Guest), and for guests the
  channels they get. Sends the invite (§9.5). An address already in the company: "Already in Paliath Interiors."
- **Pending invites:** address, role, invited by, expires in N days; **Resend** and **Cancel**.

### 5.12 PM link (`integration.tsx`, Owner/Admin)

Read-only status: connected or not, when the PM app last called, the last answer that couldn't be delivered
(in plain words), and **"N people in <PM app> aren't on Siteline yet"** with **Invite** next to each
(pre-filled). The link itself is set by the Siteline team in the MVP (§9.2).

### 5.13 Project settings (Managers, Owner/Admin)

- **Channels:** list, edit name / private / who is in it, add, delete (not `#general`).
- **People:** linked projects get their members from the PM app; here a Manager only changes **which channels**
  each member is in and adds or removes **guests**. Unlinked projects: add/remove members and set roles and job
  titles as in the demo.
- **Project:** Archive (unlinked projects; linked ones follow the PM app) and **Delete** (Owner/Admin, type the
  name).

### 5.14 Unsent, 5.15 DMs tab

As in the demo: Unsent lists **Not sent** and **Waiting** queue items with Retry / Discard. DMs tab: Siteline
Bot first, then people by latest message; **New message** opens the company directory.

---

## 6. Forms inside chat

react-hook-form + zod; the server validates again.

| Form | Fields | Result |
|---|---|---|
| **Report issue** | What's wrong* (company problem types + Other with text), Photos (0–4), Related task (optional; the tasks of cards the PM app sent about this project in the last 30 days), Urgency (Normal / Urgent) | Issue card; Urgent mentions the project Managers and sends them a push |
| **Daily report** | Work done today*, People on site (stepper), Photos (0–6), Problems, Tomorrow's plan | Daily report card |

**"New task" is removed.** Creating tasks from chat waits until the PM app has an API for it.

---

## 7. Data model

### 7.1 Tables (Postgres)

Every table except the **global** ones has `company_id uuid not null` and row-level security (§10.4).
IDs are UUIDv7. Times are `timestamptz`.

| Table | Key columns | Notes |
|---|---|---|
| **Global** | | |
| `users` | id, name, email (unique, lower case, nullable), phone (unique, E.164, nullable), avatar_color, language, deleted_at | A person. At least one of email/phone. No company here. |
| `companies` | id, name, slug, time_zone, setup (jsonb), pm_company_id, status (active / suspended / deleted), created_at | Created only by the platform (§9.2) |
| `integrations` | company_id, kind (mock / http), api_key_hash (the key the PM app calls with), webhook_url, webhook_secret (encrypted), last_call_at, last_error, options | One per company (§9.3) |
| `otp_codes` | id, identifier, code_hash, expires_at, attempts, created_at | Codes stored hashed |
| `sessions` | id, user_id, company_id, refresh_hash, device, created_at, last_used_at, revoked_at | A session is for one company; switching makes a new one |
| `push_tokens` | user_id, token, platform, updated_at | Per device |
| `platform_admins` | email, created_at | Siteline staff |
| `audit_log` | id, company_id (nullable), actor (user or platform admin), action, target, data, at | Never edited |
| **Per company** | | |
| `memberships` | company_id, user_id, role (owner / admin / member / guest), status (active / deactivated), joined_at | A person's place in a company |
| `invites` | id, company_id, identifier, name, role, channel_ids, invited_by, expires_at, status (pending / accepted / cancelled / expired) | §9.5 |
| `projects` | id, company_id, pm_project_id (nullable, unique per company), name, client, address, pm_url, archived_at | A **project space**: channels and people; no stages, no dates |
| `project_members` | company_id, project_id, user_id, role (manager / member), job_title, source (pm / manual / guest) | |
| `channels`, `channel_members`, `messages` | as in the demo, plus company_id | `kind`: project / company / dm / bot |
| `cards` | id, company_id, ext_id (the PM app's id, unique per company), user_id, project_id, message_id, content (jsonb), ref (jsonb), state (open / answered / closed / expired), answer (jsonb), answered_at, seen_at, nudged_at, delivery (pending / delivered / refused / failed), delivery_error, expires_at | A card from the PM app and its answer (§8) |
| `webhook_deliveries` | id, company_id, event, payload, attempts, next_at, status, last_error | Answers and other events on their way to the PM app |
| `activities` | as in the demo, plus company_id | |
| `uploads` | id, company_id, user_id, key (R2), content_type, size, created_at | |
| `jobs` | id, company_id, kind, run_at, payload, dedupe_key (unique), status, attempts, locked_until, last_error | §10.6 |

### 7.2 Message types and renderer registry

`text | image | voice | file | card | issue_card | daily_report | status_card | system`. `task_card` is removed;
`checkin` messages from 2.0 are shown as cards.
Unknown type → "Update the app to see this message."

### 7.3 Fields the server adds for the viewer

| Reply | Extra fields |
|---|---|
| `ProjectView` | `members`, `access { role, jobTitle, permissions[] }`, `linked` (from PM) |
| `ChannelView` | `memberIds`, `peerId`, `joined`, `unreadCount`, `lastReadMessageId`, `lastMessage`, `canPost` |
| `MessageView` | `replyCount`, `lastReplyAt`, `canEdit`, `canDelete`, `canPin` |
| `CardView` | the card's content in the reader's language, project name, `state`, `answer`, `delivery` (sending to the PM app / saved / not saved + reason), `queuePosition` |
| `UserView` | `role`, `canDeactivate`, `canChangeRole` |
| `GET /me` | user, current company, `companies[]` (with unread counts), `permissions[]`, `simpleMode` |
| `GET /meta` | the company's setup in the reader's language: job titles, problem types, default channels, percent steps, edit/delete windows |

---

## 8. The bot (Siteline Bot)

One `bot` DM per person per company. A full-width column, no avatars. **Siteline decides nothing here:** every
card comes from the PM app through the Cards API (`docs/CARDS_API.md`), which also decides reminders and
escalations. Siteline draws the cards, delivers answers, and keeps its guarantees (§8.4).

### 8.1 Where cards come from

- `POST /api/v1/cards` from the PM app: to one person (by email or phone), optionally about a project, with a
  title, subtitle, a badge (for example red "Overdue"), fields, and answer parts: a one-tap **scale**, up to 3
  **buttons** (a button can open a list of **choices**), and whether a **note** (text, voice note, photo) may be
  added. Text comes in up to three languages; the person sees theirs.
- The PM app's own id makes sending safe to repeat. `PATCH` changes or closes an open card ("Changed in the PM
  app"); `nudge` adds a quiet reminder line and a push; `expiresAt` ends it ("Expired").
- A card with no answer parts is information, for example a morning summary.

### 8.2 The card

As in 2.0, now drawn from the card's content:
- One question at a time: only the oldest open card is expanded; the others are one-line rows with **Update**.
  The progress bar counts this round: "3 cards need an answer · 0 of 3 done", then "All caught up. Thanks!".
- Open card: title, subtitle (red when the badge's tone is danger), "1 of 3", the scale (the part already reached
  shaded), the buttons as quiet outlined buttons; a button with choices swaps the scale for its list. **Note**
  adds text, a voice note or a photo.
- Answered card: one line, "False ceiling – living room · ● 75% · 6:04 PM", plus the note.
- No coloured buttons and no emoji; colour only as a small dot or the badge.

### 8.3 What happens to an answer

1. The app sends `POST /cards/:id/answer` through the send queue (safe to repeat); voice notes and photos upload
   first.
2. Siteline saves it and queues a `card.answered` **webhook** to the PM app (§9.3), with the answer, the note,
   links to the files and the PM app's own `ref`.
3. The card shows **"Sending to <PM app>…"** until the PM app replies. A refusal ("This task is already closed")
   shows as "Not saved: …"; no reply after 24 hours of retries shows "Couldn't reach <PM app>" and the company's
   admins are told.
4. What follows is the PM app's choice: a status card in the project's channel and Activity for its Managers
   (`POST /api/v1/messages` with `notify`), a follow-up card, or nothing.

### 8.4 What Siteline guarantees

- A card only reaches an active member of that company; an unknown ref is refused (`NOT_A_MEMBER`).
- Card pushes follow each person's notification level and wait for their quiet hours.
- Answers made without signal are kept on the phone and delivered later, once, in order.
- Every answer reaches the PM app at least once; each webhook has an id so the PM app can drop repeats.
- Cards stay inside their company (§9.7); the PM app's key works for its company only.

---

## 9. Companies, people and the PM app

### 9.1 Roles

**Platform:**
- **Super-admin** (Siteline staff, `platform_admins`). Creates, suspends and edits companies and their PM
  links, resends the owner invite, transfers ownership. **Cannot read any company's messages, channels or
  files.** Every action goes to `audit_log`.

**Company** (`memberships.role`):
- **Owner:** everything; the only one who adds or removes Admins; exactly one per company.
- **Admin:** invites and deactivates Members and Guests, sees every project and channel (never other people's
  DMs), manages projects.
- **Member:** the projects they are on; the directory; DMs with anyone in the company.
- **Guest** (client, architect, subcontractor): only the channels they were given; can't browse channels, the
  directory or other projects; DMs only with people who share a channel; can't be a project Manager; gets bot
  cards from the PM app like anyone else.

**Project** (`project_members.role`): **Manager**, **Member**. Job title sets default channels only.

Permissions live only in `backend/app/rules.py`; the server enforces them and tells the app (as in the demo).

```python
PROJECT_PERMISSIONS = {
  "manager": ["project.edit", "project.members", "channel.manage", "message.delete_any", "message.pin"],
  "member":  [],
}
COMPANY_PERMISSIONS = {
  "owner":  ["company.people", "user.invite", "user.invite_admin", "user.role", "project.create", "project.delete", "pm.status"],
  "admin":  ["company.people", "user.invite", "project.create", "project.delete", "pm.status"],
  "member": ["company.directory"],
  "guest":  [],
}
```

### 9.2 Creating a company (super-admin only)

No public sign-up. From the **platform panel** (§10.8) the super-admin enters:
- company name, time zone, industry template (`interiors`, `events`, `general`);
- the PM link: PM company id and the PM app's webhook URL, or the **mock PM app** (§10.8), or none;
- the owner's name and email or phone.

The server, in one transaction:
1. creates the company with the template copied into `setup`;
2. creates `#announcements` and `#general`;
3. creates the owner's invite (role Owner);
4. writes the audit log;

and after commit queues the invite message. With a PM link, the panel shows the new API key and webhook secret
once, to hand to the PM team.

The same action is `POST /platform/companies`, protected by a platform API key, so the PM app can call it
later when a customer turns Siteline on.

**Suspend:** sign-in to that company is refused (`COMPANY_SUSPENDED`), sessions are revoked, and the PM app's
key stops working (`COMPANY_SUSPENDED`). **Delete:** suspended first, data removed after 30 days.

### 9.3 The PM link (the Cards API)

**The PM app calls Siteline; Siteline only calls the PM app's webhook URL.** Full reference for the PM team:
`docs/CARDS_API.md`.

- **Connecting:** the Siteline team links the company on the platform panel. Siteline makes an **API key** for
  the PM app (shown once, stored hashed, rotatable with 24 hours' overlap) and a **webhook secret**, and saves
  the PM app's **webhook URL**. The key decides the company: every call with it acts only in that company.
- **Projects and people:** `PUT /api/v1/projects/{ref}` with name, client, address, link, status (active /
  closed) and the full member list (email or phone, Manager or Member, role name). Siteline creates or updates
  the project space with the setup's standard channels, archives it when closed, adds and removes PM members
  (role name → job title → default channels; unknown → the setup's default), keeps guests added in Siteline,
  and answers with the refs it doesn't know yet. Those are listed on the PM link screen with **Invite**.
- **Cards and channel messages:** §8; `POST /api/v1/cards`, `PATCH /api/v1/cards/{id}`,
  `POST /api/v1/cards/{id}/nudge`, `POST /api/v1/messages`.
- **Webhooks to the PM app:** `card.answered` (and optionally `card.seen`), `person.joined`, `person.left`.
  Signed with HMAC-SHA256 over `"<timestamp>.<body>"` (`X-Siteline-Signature`, `X-Siteline-Timestamp`), with an
  id per event (`X-Siteline-Id`). Retries after 1, 5 and 15 minutes, then hourly for 24 hours.
- **Limits:** 120 calls a minute per company.
- **Files in answers:** links valid for 7 days, plus upload ids the PM app can attach to its channel messages.
- **No PM link** (a company that doesn't use a PM app): no cards; projects are made in Siteline (§5.2).

### 9.4 Sign-in and sessions

- Any active user may request a code; so may an identifier with a pending invite. Others get the same reply
  ("If this address is on Siteline, we sent a code") and no code.
- **Codes:** 6 digits, valid 10 min, stored hashed. 5 wrong attempts burn the code. At most 5 codes per
  identifier per hour and 20 per IP per hour. Resend after 30 s.
- **Staging/development only:** a fixed code for seeded test accounts. It is impossible in production (checked
  at start-up).
- **Verify** → the person's companies and invites; picking a company makes a **session for that company**:
  - a 1-hour access token (opaque, stored hashed) and a 60-day refresh token that rotates on every use;
  - reusing an old refresh token revokes the session;
  - **switching company** = `POST /auth/switch {companyId}` (checks membership, makes a new session);
  - tokens are kept in SecureStore.
- **Log out** revokes the session. **Deactivation** revokes that company's sessions only.

### 9.5 Invites

- Owner/Admin invite by **email or phone** with a role (and channels for guests).
- The invite is sent as an email or SMS: "Arjun invited you to Paliath Interiors on Siteline. Get the app:
  <link>". The link only opens the store or the app. **Signing in with that email or phone is what accepts the
  invite** (§5.1), so there is no secret in the link.
- Invites expire after 14 days. Resend restarts the timer; Cancel stops it.
- Inviting someone already active in the company → `ALREADY_MEMBER`.
- A person in another company is simply invited; on sign-in they see the new company next to theirs.
- **New members start with:** both company channels and a bot DM. Guests start with only their chosen channels
  and a bot DM.

### 9.6 Deactivating, roles, ownership

- **Deactivate** ends access to that company only (sessions revoked, channels and projects gone at the next
  event). Messages stay under their name. Owner: anyone but themselves; Admin: Members and Guests.
- **Change role:** Owner sets Admin / Member / Guest. Admins set Member / Guest.
- **Ownership** moves only through the super-admin (transfer), which keeps exactly one Owner.

### 9.7 Separation rules (tested)

1. The company comes from the session, never from the request. A `companyId` in a body is ignored.
2. An ID from another company returns **404**, never 403.
3. Every query runs with row-level security on (§10.4); a missed filter returns nothing, not someone else's data.
4. Events go only to users of the same company; the hub drops and logs anything else.
5. File keys start with the company id; a signed link is made only after the channel check.
6. Jobs carry `company_id`, and the worker sets it before touching data.
7. The PM link and its keys are per company; a webhook's signature is checked with that company's secret.
8. Logs and Sentry never contain codes, tokens, API keys or message bodies.

### 9.8 Account deletion

**Delete my account** (You):
- removes the person's email, phone, name and push tokens, and deactivates all their memberships;
- their messages stay as "Former member";
- it is required by the app stores.

### 9.9 Universal rules (unchanged)

- Edit own message ≤15 min.
- Delete own message ≤1 h ("This message was deleted").
- DMs are private to the two people.
- Owner/Admin see every project channel, but never other people's DMs.

**Channel rules:**
- Managers are in every channel of their project.
- `#general` can't be renamed, made private, deleted or left.
- Archived projects are read-only.
- Deleting a channel or project removes its messages for everyone.

---

## 10. Backend

### 10.1 Shape

```
backend/
  app/
    main.py           API app: error format, routers, WebSocket /ws
    worker.py         worker entry point: runs jobs (§10.6)
    config.py         settings from the environment; refuses unsafe production settings
    db.py             Postgres access, transactions (sets the company for row-level security), migrations
    rules.py          permissions and rules (the only copy)
    access.py         who may see and change what; event audiences
    views.py          what a record looks like to a viewer
    schemas.py        request validation
    routers/          HTTP only: auth, me, people, projects, channels, messages, cards, uploads, platform,
                      integration_api (the Cards API, /api/v1), internal (development only)
    services/         business actions: messaging, accounts, companies, projects, cards, webhooks, files, secrets
    jobs/             queue.py (enqueue, claim, retry), handlers.py
    senders/          email.py, sms.py, push.py
    mockpm/           the stand-in PM app: decides what to ask and when, calls the Cards API, takes the webhooks
    events.py         WebSocket hub + LISTEN/NOTIFY
    setups/           industry templates: interiors.py, events.py, general.py
    seed.py, actors.py, netsim.py   development and staging only
  db/migrations/      numbered SQL files
  tests/
```

Layering as before: routers translate HTTP only; actions live in `services/`, rules in `rules.py`, visibility
in `access.py`; only `main.py` imports routers (checked by a test).

### 10.2 Environments

| | Development | Staging | Production |
|---|---|---|---|
| Database | local Postgres (Docker) | Render Postgres | Render Postgres, backups + point-in-time recovery |
| Codes | fixed code for seeded accounts | fixed code for seeded accounts | real email/SMS only |
| PM link | mock PM app | mock PM app | mock PM app until the real one uses the Cards API |
| `dev/` (seed, teammates, /internal, dev panel) | on | on | off |
| App build | development | preview | production |

Secrets come only from the environment.

### 10.3 Endpoints

| Method & path | Notes |
|---|---|
| `POST /auth/otp/request` `{identifier}` | Same reply for unknown addresses; rate-limited |
| `POST /auth/otp/verify` `{identifier, code}` | → `{pendingToken, companies[], invites[]}` |
| `POST /auth/invites/:id/accept` / `decline` | With the pending token or a session |
| `POST /auth/session` `{companyId}` / `POST /auth/switch` | → `{accessToken, refreshToken, me}` |
| `POST /auth/refresh` / `POST /auth/logout` | Rotating refresh; logout revokes the session |
| `GET /me` / `PATCH /me` `{name?, language?, notifications?}` / `DELETE /me` | Profile, companies, permissions |
| `PUT /me/push-tokens` `{token, platform}` / `DELETE` | |
| `GET /meta` | Company setup in the reader's language |
| `GET /users` | Company directory (not for guests) |
| `PATCH /members/:userId` `{role}` / `POST /members/:userId/deactivate` | |
| `GET /invites` / `POST /invites` `{id, identifier, name, role, channelIds?}` / `POST /invites/:id/resend` / `DELETE /invites/:id` | Owner/Admin |
| `GET /integration` | PM link status (Owner/Admin) |
| `GET /projects` / `GET /projects/:id` / `POST /projects` (unlinked companies) / `PATCH` / `DELETE` | |
| `POST /projects/:id/members` / `PATCH|DELETE /projects/:id/members/:userId` | Guests, channels; full control for unlinked projects |
| `GET /projects/:id/updates` / `GET /projects/:id/files` | |
| `GET /projects/:id/channels` / `POST /projects/:id/channels` | |
| `GET /channels` / `GET|PATCH|DELETE /channels/:id` / `POST /channels/:id/join|leave` | |
| `GET /channels/:id/messages?before=&limit=` / `POST /channels/:id/messages` | Create is idempotent by id |
| `GET /channels/:id/pins` / `GET /messages/:id/thread` | |
| `PATCH|DELETE /messages/:id` / `PUT /messages/:id/reactions/:emoji` / `POST /channels/:id/read` | |
| `GET /dms/:userId` / `POST /dms` | |
| `GET /me/cards` / `POST /cards/:id/answer` | The PM app's cards for me; answering is idempotent |
| `GET /projects/:id/tasks` | Tasks named in this project's cards in the last 30 days, for "Related task" |
| `GET /activity` / `POST /activity/read` | |
| `POST /uploads` (multipart) → `{uploadId}` / `GET /files/:id` → 302 to a signed link (5 min) | Images 10 MB, voice 5 MB, files 25 MB |
| `WS /ws?token=` | Live events |
| `/api/v1/*` | The Cards API for the PM app (§9.3, `docs/CARDS_API.md`); its own key, not a session |
| `/platform/*` | Super-admin panel and API (§10.8) |
| `/internal/*` | Development and staging only |

**Removed:** everything about tasks as Siteline data (`/tasks`, `/me/tasks`, task create/patch/shift/confirm),
baseline, task defaults, stages.

### 10.4 Row-level security

- The API connects as a database role that **does not own** the tables and has no `BYPASSRLS`.
- Each request runs in a transaction that starts with `SET LOCAL app.company_id = '<session company>'`.
- Every per-company table has `USING (company_id = current_setting('app.company_id')::uuid)` for reads and
  writes.
- Global tables are reached only through `services/` functions that don't need a company (sign-in, platform).
- A test opens two companies and checks that every route and every table returns nothing across them.

### 10.5 Behaviour rules

- Permission checks on every route; hidden records **404**, role violations **403**.
- Validation failures → **422** `VALIDATION_FAILED` with `details.fields`.
- Error format:
  `{ "error": { "code": "...", "message": "...", "details": {}, "request_id": "req_..." } }`.
- Idempotency: creates keyed by client UUID; updates are absolute values.
- **Events after commit**, only to allowed users of the same company:
  `message.*`, `channel.*`, `project.updated|deleted`, `card.new|updated`, `activity.new|read`,
  `user.updated`, `membership.removed`. The app treats every event as "this changed" and refetches.
- **Push** for DMs, mentions, thread replies to you, cards, the PM app's notifications and urgent issues, following each
  person's notification setting and quiet hours. Push text names the sender and channel and shows a short
  preview.

### 10.6 Jobs

- `jobs` table; the worker claims due jobs with `SELECT … FOR UPDATE SKIP LOCKED`, runs them, and marks them done.
- Failures retry with backoff up to a limit per kind, then the job is marked failed and reported to Sentry.
- `dedupe_key` (unique) stops doubles: for example `webhook:<card>`.
- **Kinds:** `webhook` (deliver to the PM app, with retries), `send_push`, `send_code`, `send_invite`, `cleanup`;
  in development and staging also the mock PM app's own jobs (its daily plan, check-ins, reminders, escalations).
- Jobs are queued in the same transaction as the change that causes them, so a crash never loses one.
- `shortcut:` one worker process; add more workers when job lag passes 1 minute (claiming already allows it).

### 10.7 Live events

- The API keeps WebSocket connections and pings every 25 s.
- Any process that commits a change sends `NOTIFY events` with `{companyId, audience[], event}`; every API
  process listens and delivers to its own connections. Events stay small; the app refetches.
- `shortcut:` NOTIFY payloads are limited to 8 kB; events carry ids, never message bodies.

### 10.8 Platform panel

- Server-rendered pages at `/platform`, for emails listed in `platform_admins`.
- Sign-in uses a code to that email, with an 8-hour session.
- Pages:
  - **Companies:** list, create, suspend, edit setup (JSON with validation), PM link (webhook URL; make or
    rotate the API key and webhook secret, shown once), resend owner invite, transfer ownership.
  - **Mock PM app** (companies linked to it): projects, members and tasks; edit dates, owners and status to
    drive its cards.
  - **Audit log.**
- **No page shows messages or files.**

### 10.9 Error codes

`OTP_INVALID, OTP_EXPIRED, OTP_TOO_MANY_ATTEMPTS, AUTH_EXPIRED, NO_COMPANY, COMPANY_SUSPENDED, NOT_A_MEMBER,
ALREADY_MEMBER, INVITE_EXPIRED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, MESSAGE_EDIT_WINDOW_PASSED,
CHANNEL_READ_ONLY, CHANNEL_NAME_TAKEN, CHANNEL_PRIVATE, PROJECT_ARCHIVED, PROJECT_LINKED, FILE_TOO_LARGE,
CARD_CLOSED, RATE_LIMITED, INTERNAL_ERROR, SERVICE_UNAVAILABLE` (plus client-side `OFFLINE`,
`TIMEOUT`, `UNKNOWN`), each with English, Kannada and Hindi messages.

### 10.10 Operations

- **Backups:** daily, plus point-in-time recovery, kept for 14 days; a restore is tested once before launch and
  then every quarter.
- **Monitoring:** Sentry errors and performance, health check `GET /health` (database and worker heartbeat),
  alerts on error spikes, job lag over 5 min, and failed PM writes.
- **Logs:** JSON with request id and company id; no secrets, codes or message bodies; kept 14 days.
- **Load test** before launch: 3,000 WebSocket connections and 50 messages/s for 10 minutes, p95 API under
  300 ms.
- **Security:**
  - HTTPS only;
  - PM keys encrypted with a key from the environment;
  - dependencies scanned in CI;
  - rate limits on sign-in, invites and uploads;
  - uploaded file types checked by content, not by name.

---

## 11. Seed data (development and staging only)

- **Paliath Interiors** (`interiors` template, Asia/Kolkata): the demo's people, linked to the mock PM app with
  projects Villa 99, RV University and OITH and their tasks.
- **Brightline Events** (`events` template): 5 people, 2 projects in the mock PM app.
- **Suresh** is in both companies to test the picker and the switcher.
- Ravi has an open card on first sign-in.
- Scripted teammates (`dev/actors.py`) post now and then in Paliath and can be paused.

Production starts empty: the first company is created from the platform panel.

---

## 12. Client architecture

### 12.1 Folders

```
src/
  features/
    auth/ home/ chat/ projects/ people/ bot/ activity/ profile/ unsent/ dev/
      screens/  components/  hooks.ts (reads)  api.ts (writes)
    shared/     session, data, display, messages, photos — imports no feature
  lib/
    api/        client.ts (AppError, refresh, company header), transport.ts (the only place that knows the server address)
    queries.ts  cache keys, keys scoped by company; event → refresh map
    outbox.ts   send queue; persist.ts saved screens per user and company
    push.ts     permission, token registration, opening a notification's deep link
    realtime/   socket.ts
    i18n/ format.ts session.ts
  contract/     error codes, zod schemas
  components/   T, basics, Sheet, form, chrome, PhotoGrid, CompanyTile
  stores/       session (current company), ui, dev
  theme/
```

Features depend on each other one way only (checked by `boundaries.test.ts`); the `tasks` feature is removed.
Screens never call the API directly.

### 12.2 Where data lives

- **Server:** everything.
- **Query cache:** saved per **user and company** for 7 days to show while offline. Switching company shows that
  company's saved screens, never another's.
- **Send queue:** per user and company. Items for another company wait until it is opened again.
- **Sign-in:** tokens in SecureStore.
- **Sign-out** deletes that session's saved screens; a deliberate log out also deletes the queue (after the
  warning).

### 12.3 API client

As in the demo: one `api<T>()`, auth header, `X-Request-Id`, `Accept-Language`, `AppError` kinds, one shared
refresh on 401. The server address comes from the build profile (`EXPO_PUBLIC_API_URL`).

### 12.4 Send queue

As in the demo for **messages (with photos, voice notes, files)** and **card answers**: saved first, safe to
repeat, oldest first, uploads before their message, retries with backoff, refusals shown as **Not sent**. The
phone never works out results: a queued answer shows as answered with a clock until the server replies, then
"Sending to <PM app>…" until the PM app accepts it.

Online only: edit, delete, react, pin, project/channel/member settings, invites, roles, deactivation.

### 12.5 Reads, realtime, errors

As in the demo:
- Every screen reads through a query.
- Events, reconnects, returning to the foreground and pull-to-refresh refetch.
- Errors show translated messages by code, plus an offline banner, "Couldn't load" states and an error boundary
  per screen.

### 12.6 Push

- After sign-in, ask for permission once the person has seen Home (not on launch).
- Register the Expo push token with `PUT /me/push-tokens`; remove it at log out.
- Tapping a notification opens its deep link (§4), switching company if needed.

---

## 13. Dev panel (development and preview builds only)

The demo's Demo panel, renamed:
- switch between seeded accounts;
- network modes and error injection;
- ask the mock PM app to send a morning summary, a card or an escalation now;
- pause teammates;
- API and event log;
- reset staging seed.

It is not compiled into production builds (`EXPO_PUBLIC_ENV`), and the server refuses `/internal/*` in
production.

---

## 14. Acceptance criteria (each must work on staging, on a real Android phone)

1. **New company:** a super-admin creates "Brightline Events" with an owner phone number → the owner gets an
   SMS, signs in with the code, sees the company, `#announcements`, `#general` and the bot.
2. **Invite:** the owner invites a worker by phone and a designer by email → each signs in, sees "invited you",
   joins, and gets their default channels when the PM app adds them to a project (`PUT /api/v1/projects`).
3. **Separation:** a Paliath member can't see, search, fetch by id, or receive events or files from Brightline
   (automated tests over every route, plus a manual check).
4. **Two companies:** Suresh signs in → picker; opens Paliath; switches to Brightline from the header; unread
   counts, saved screens and the send queue stay per company; a push from the other company opens it.
5. **A card from the PM app:** the mock PM app sends Ravi a card about an active task at 17:30 company time →
   Ravi gets a push and the card; taps 75% → the mock PM app receives `card.answered` and shows 75%, then posts
   a status card in `#site-work` with an Activity item for the Manager.
6. **Information cards:** the mock PM app's 08:30 morning summary shows as a card with one row per task.
7. **Nudge and escalation:** the mock PM app nudges an unanswered card (one reminder line and a push), then posts
   an escalation card with `notify.managers`; each happens once, even if the worker restarts.
8. **Offline answer:** phone offline, answer a card and send a photo → both wait; back online → both arrive once,
   in order, and the PM app gets the answer once.
9. **PM app down:** the webhook URL fails → the card shows "Sending to <PM app>…", the answer is delivered when it
   answers again, once. A refusal shows its reason; 24 hours of failures shows "Couldn't reach <PM app>".
10. **Cards API safety:** a card to someone outside the company is refused; the same card id twice makes one
    card; a key from one company can't send to another; `PATCH` closes an open card on the phone at once;
    `PUT /projects` with a closed status archives the space and with a member removed takes them off it.
11. **Roles:** a guest sees only their channels, no directory, no Browse channels; a Member can't invite; an
    Admin can't add an Admin; deactivating someone removes access in that company only.
12. **Sign-in safety:** wrong code 5 times → `OTP_TOO_MANY_ATTEMPTS`; 6th code request in an hour →
    `RATE_LIMITED`; the fixed code is refused in production.
13. **Suspend:** a suspended company's people can't open it; the PM app's key is refused; their other
    companies still work.
14. **Files and voice:** photo, voice note and PDF upload to R2 and open for channel members only; a signed link
    stops working after 5 minutes.
15. **Push:** DMs, mentions, cards and the PM app's notifications arrive; quiet hours hold card pushes.
16. **Language:** Ravi in ಕನ್ನಡ → cards (when the PM app sends Kannada text), push text and errors in Kannada.
17. **Account deletion** removes the person's details; their messages show "Former member".
18. **Dark mode** looks intentional on every screen.
19. **Restore:** a backup restores into a fresh database and the app works against it.
20. **Load test** passes (§10.10).

---

## 15. Build order

Each step ends with tests passing and the app working against it.

1. **Spec and decisions** (this file).
2. **Remove project management**, on the current in-memory backend, before Postgres, so no tables are built for
   deleted features. First the PM connector interface and an in-memory mock PM holding the seeded tasks, with
   the bot switched to it; then the old task code is deleted (§0.1). Step by step in
   `docs/PLAN_REMOVE_PROJECT_MANAGEMENT.md`.
3. **Database:** Postgres, models, Alembic, row-level security, the store replaced by queries; the existing
   chat and bot tests pass on Postgres; tenant separation tests.
4. **Accounts:**
   - users, memberships, invites, code sign-in by email and SMS, sessions per company, switch;
   - platform panel: create company, suspend, audit log;
   - app: login, code, picker and switcher, invites screen.
5. **PM sync (2.0, replaced by step 8):** the mock PM moves to Postgres with its platform panel; sync, webhooks, project spaces from PM
   projects, member matching, PM link screen.
6. **Bot on jobs (2.0; the bot's decisions move out in step 8):** jobs table and worker, planner from PM dates and company time, check-ins, reminders,
   escalations, PM writes with retries, LISTEN/NOTIFY events.
7. **Files, voice, push:**
   - R2 uploads and signed links, voice notes, files;
   - push tokens and sending, quiet hours;
   - EAS development, preview and production profiles; Sentry.
8. **The Cards API (version 2.1):** the API for the PM app (`/api/v1`, keys, projects, cards, nudges, channel
   messages, webhooks with retries); cards in the app drawn from their content; the 2.0 bot (planner, PM sync,
   PM writes, saved copy of tasks) moves out of Siteline into `mockpm/`, which uses the Cards API like the real
   PM app will. Step by step in `docs/PLAN_CARDS_API.md`.
9. **Launch:**
   - staging and production on Render, backups and a restore test;
   - load test, store listings, privacy policy;
   - one pilot company, with its PM app on the Cards API.

Before calling any step done: `npm run typecheck`, `npm run lint`, `npm test` in `frontend/`, and
`npm run test:api` (pytest against Postgres).

---

## 16. Quality bar

- 60 fps in channels with 500 messages on a mid-range Android phone.
- Every screen has designed empty, loading (skeleton rows) and error states.
- No layout jumps when images load.
- Plain, short copy; buttons are verbs.
- Accessibility:
  - labels on icon buttons;
  - contrast in both themes;
  - dynamic type up to 130%;
  - screen reader order makes sense on a card.
- No data from one company ever shown in another, including saved screens, pushes and the send queue.

---

## 17. Out of scope for the MVP

- Self sign-up, domain verification, SSO, passwords.
- Owners connecting the PM app themselves (the Siteline team sets the link).
- Cards from other tools than the company's PM app (the API allows one integration per company).
- Creating or editing tasks from chat.
- Billing.
- A web or desktop client.
- Message search beyond the loaded history, video calls, end-to-end encryption, data export, AI features.

---

## 18. Open questions for the PM team

1. Can the PM app call the Cards API (`docs/CARDS_API.md`) and take its webhooks? Who builds its scheduler
   (what to ask, when, reminders, escalation)?
2. How are people identified in the PM app: email, phone, or both? They must match how they sign in to Siteline.
3. Files in answers: are 7-day links enough, or should the PM app copy the files when the webhook arrives?
4. Should the PM app send cards in Kannada and Hindi too, or English only at first?

---

## Appendix A — copy tone

| Situation | Text |
|---|---|
| Offline banner | You're offline. Messages and answers will send when you're back. |
| Failed message | Couldn't send. Tap for options. |
| Sending answer | Sending to <PM app>… |
| PM refused | Not saved: <PM app> says this task is closed. |
| No company | You're not in a company on Siteline yet. Ask your admin to invite you. |
| Invite | Arjun invited you to Paliath Interiors. |
| Empty channel | No messages yet. Share an update or a photo. |
| Read-only channel | Only admins can post here. |
| Removed from company | You no longer have access to Paliath Interiors. |
| Archived project | This project is archived. It is read-only. |
| Bot progress | 3 cards need an answer · 0 of 3 done |
| Bot finished | All caught up. Thanks! |
| Logout warning | 3 changes haven't been sent yet. Log out anyway? |
