# Decisions and deviations from the spec

> **Note:** `SITELINE_DEMO_SPEC.md` was rewritten as version 1.2 to describe the app as built. The
> entries below are kept as the record of what changed from the first version of the spec and why.

`SITELINE_DEMO_SPEC.md` is the source of truth. This file records every place where the build
differs from it, or where the spec left a choice open. Built against **Expo SDK 57**
(React Native 0.86, React 19.2, Reanimated 4.5).

## Libraries

| Spec | What was done | Why |
|---|---|---|
| `@gorhom/bottom-sheet` for sheets | **Own `Sheet` component** (`src/components/Sheet.tsx`) built from React Native `Modal` + Reanimated + gesture-handler. The library is not installed. | On SDK 57 in Expo Go, `BottomSheetModal.present()` was called but the sheet never animated in (5.2.14, tested on an Android 16 emulator). Every sheet in the app goes through `Sheet`, so switching back later means changing one file. |
| FlashList "inverted" for chat | FlashList 2 with `maintainVisibleContentPosition={{ startRenderingFromBottom: true }}`, data oldest → newest, older pages loaded with `onStartReached`. | FlashList 2 removed the `inverted` prop; this is its documented replacement for chat lists. |
| Date pickers | Month calendar in a sheet with Today / Tomorrow / In a week shortcuts (`DateField` in `src/components/form.tsx`). | No native date picker is in the allowed stack. |
| Progress ring | Drawn with plain views (two rotating half discs). | No SVG library is in the allowed stack. |
| Voice note, File | **Simulated.** The mic "records" a timer and posts a voice message with that length; File posts a sample PDF chip. | No audio or document-picker library is in the allowed stack. Camera and gallery are real (`expo-image-picker`). |
| ESLint | `eslint@9` + `eslint-config-expo`, with `legacy-peer-deps=true` in `.npmrc`. | ESLint 10 crashes `eslint-plugin-react`; npm's strict peer resolution fails on a `react-dom` peer range inside Expo's own dependencies. |

## Navigation

- **Route files are thin.** Every file in `app/` (apart from `_layout.tsx`) only reads the URL
  parameters and renders a screen from `src/features/<area>/screens/`. All screen layout and
  logic lives under `src/features/`, so there is one place to look for each area.

- Tab files are `app/(app)/index.tsx`, `tasks.tsx`, `activity.tsx`, `you.tsx` instead of
  `(home)/index.tsx`, `(tasks)/index.tsx`, … Four `index` routes in sibling groups all map to the
  URL `/`, which Expo Router cannot tell apart.
- For Owner/Admin the `tasks` tab is retitled **Dashboard** and renders the dashboard.
  `app/dashboard.tsx` also exists as a stack screen, as listed in the spec.
- Task detail is a transparent modal screen styled as a full-height sheet.
- The Members tab on the project page and `project/[id]/members.tsx` render the same
  `MembersManager`; managers get the add/edit/remove controls in both.

## Data model additions

- `Activity` type + local `activity` table; the server sends them in `/sync` (`activities`) and as
  an `activity.new` event. The spec describes the Activity screen and batching but not its storage.
  "Seen" state is kept on the phone only.
- `Attachment` type for photos inside `message.data.attachments`.
- `User.online` (optional) for the presence dot.
- `CheckinAnswer.kind` also allows `'not_started'`, so the "Not started" button does not have to
  pretend the task was started. It changes nothing on the task.
- `/sync` response also has `cursor` (paging), `activities`, and `removed.projects`.
- Message `data` flags used by the app: `edited`, `pinned`, `mentions`, `alsoToChannel`.
- Outbox kinds `create_dm` and `create_project` (see next section).
- Theme: extra colour tokens `execution`, `executionSoft`, `onAccent`, `headerField`, `scrim`,
  `shadow`; extra type styles `metaStrong` and `button`.

## Mock server

- Extra endpoints: `POST /dms` (open a DM, needed for "New message") and `POST /projects`
  (needed for "New project"). Both are idempotent by client id.
- Uploads: `POST /uploads {clientId}` → `{uploadId, uploadUrl}`, then `PUT /uploads/:id/content`.
  The mock keeps the local file URI, so a real photo is only viewable on the phone that took it.
- A photo message is rejected (422) until its uploads have finished, which is what makes the
  "upload first, then message" ordering observable.
- Memberships (`projectMembers`, `channelMembers`) are sent **in full** on every sync, not as
  changes: they are small, and it makes access changes simple and reliable.
- "Inject on next request" applies to the next **change** the app sends. Sync, auth and
  read-marker requests are skipped so the injected error always lands on the action being shown.
- The project's planned finish is recomputed from its latest task finish.
- Tasks created after the baseline is locked have no baseline of their own (new scope).
- A project must keep at least one manager (422 otherwise).
- Files beyond the spec's list: `http.ts` (routing/validation helpers), `notify.ts` (activity +
  10 s batching), `bot.ts` (check-ins, reminders, escalation). Check-ins, uploads, dashboard and
  directory routes share `routes/misc.ts` rather than one file each.
- The scripted "Amit shifts 5 tasks" alternates one day later / one day earlier, so a long demo
  does not push the whole schedule out.
- Demo timings: reminder 60 s, escalation 60 s later, task-change batching 10 s, request timeout 8 s.

## Client behaviour

- **Local database is dropped on every app launch.** The mock server lives in memory and is gone
  after a reload, so data from the previous run would be orphaned. Outbox rule 5 (`sending` →
  `pending` on start) is implemented in `initDb()` and runs first; with a real backend, delete the
  `dropAll()` call there and it takes effect.
- Session (tokens, user), language, theme and collapsed sections are in memory (zustand) and
  reset on reload, as the spec allows for tokens.
- Optimistic local changes do not touch `updatedAt`; only server values do. "Newer wins" therefore
  always compares server clocks, and pending changes are re-applied on top (rule 6).
- Background housekeeping (`mark_read`, reactions) is dropped silently if the server refuses it for
  good, and read markers are not counted in "N waiting".
- For changes that touch many rows (baseline lock, member add/update/remove) a permanent failure
  triggers a full re-sync instead of a field-by-field rollback.
- The message row shows a clock for both `pending` and `sending`.
- Replies that arrive after a logout or user switch are discarded (session guard in sync and
  outbox), so one user's data can never land in another user's local database.
- Wipes use `DELETE … WHERE 1`: a bare `DELETE FROM table` skips SQLite's change hook and live
  queries would keep showing old rows.

## Product choices the spec left open

- **Tasks tab:** Owner/Admin → Dashboard; anyone who manages at least one project → schedule list
  (managed projects first in the switcher); everyone else → "My tasks".
- Non-managers do not see baseline or variance in task detail either (the spec says this for
  "My tasks").
- Home project rows expand/collapse on tap; "Project overview" is a row inside the expanded
  project.
- Quick add targets the phase currently being worked on; the chip next to the input changes it.
- "Problem" on My tasks sets the task to Blocked and posts an issue card in the task's channel.
- Removal copy reads "Ravi will lose access to this project. **Their** messages stay." (the spec
  says "His"; the app does not know anyone's gender).
- The Demo pill sits a little higher than "just above the tab bar" so it does not cover composers
  and the quick-add bar. It can be dragged and hidden (You → "Show the Demo button" brings it back).
- Channel search (header icon) is a stub, as the spec permits.

## Changes requested after the first build

- Company renamed to **Paliath Interiors**; projects renamed to **Villa 99** (was Sharma Residence),
  **RV University** (was Mehta Villa) and **OITH** (was Café Brew Fit-out). Clients and addresses
  are placeholders.
- **Opening the Siteline Bot conversation asks about every open task the user owns**
  (`POST /bot/checkins`, a demo endpoint). Tasks asked about in the last 12 hours are skipped, and
  these cards carry no reminder/escalation timer. The owner and the admin were given tasks of their
  own in the seed so this works for every sign-in.
- **No emoji in bot cards.** Buttons use line icons instead of the emoji in §8, and a photo is
  shown as the words "photo attached".

- **Notes on check-in cards.** Every card has an optional note: type it, or tap the microphone to
  record a voice note (or both). The note is sent with the answer (`note`, `voiceSec`) and shown
  in the card's summary and in the status card posted to the project channel. As with voice notes
  in chat, **recording is simulated** (a timer; no audio is captured or played back).

- **Project settings** (`project/[id]/settings.tsx`; Managers, Owner, Admin). The spec gives
  managers `project.edit` and `channel.manage` but describes no screen for them. Added:
  - edit project name, client and site address (`PATCH /projects/:id` now accepts these);
  - channels: create, rename, public/private, choose who is in it, delete
    (`GET/POST /projects/:id/channels`, `PATCH/DELETE /channels/:id`);
  - a link to the existing Members screen.
  Reached from the gear in the project header, "Add or manage channels" on the overview, and
  "Channel settings" in a channel's details sheet.
- **What public and private mean.** Public: anyone on the project can find the channel under
  "Browse channels" and join it (`POST /channels/:id/join`), and can leave again. Private: only
  the people a manager ticks can see it. Rules chosen to keep this simple:
  - **Managers are in every channel of their project** and cannot be unticked or leave (this
    follows §9.3 and means a manager can always manage a channel);
  - Owner/Admin see every project channel, private or not;
  - `#general` cannot be renamed, made private, deleted or left;
  - deleting a channel deletes its messages for everyone (no archive in the demo).
- **Archive / unarchive a project** (Managers, Owner, Admin; `PATCH /projects/:id {archived}`,
  new field `Project.archivedAt`). An archived project is read-only for everyone: the server
  rejects new messages and task changes with `PROJECT_ARCHIVED`, the app hides every editing
  control, it moves to a collapsed "Archived" group on Home, and it is left out of the dashboard,
  "My tasks" and bot check-ins. Nothing is deleted.
- **Delete a project** (Owner/Admin only; `DELETE /projects/:id`). Removes the project, its
  channels, messages, tasks and memberships for everyone. The app asks the user to type the
  project name first.
- **Deleting a channel has one home:** the "Delete" action beside the title in the channel's
  editor (Project settings → tap the channel, or "Channel settings" from inside the channel).
- Deliberately **not** added: changing project dates by hand
  (they come from the tasks), per-channel "only admins can post", and notification settings per
  channel.
- Sheets now shrink above the keyboard, so a tall form's first field stays on screen while typing.

- **Sign-in screens redesigned.** Login and code entry share one layout (`AuthShell`): the ink
  brand header over a clean card. The seven demo sign-ins moved from an always-visible list
  (§5.1) into a "Use a demo account" sheet; picking one goes straight to the code screen. The
  Demo pill is hidden on these two screens.
- **DMs have their own bottom tab** (Home · DMs · Tasks · Activity · You; the spec has four tabs
  with DMs as a Home section). The tab lists the bot first, then people by most recent message,
  with a preview, time and unread count. "New message" lives there. Home's badge now counts
  channels only, and Home's action button is "New project" for Owner/Admin only.

- **Task list toolbar.** The five filter chips of §5.7 (All · Mine · Delayed · Blocked · Done)
  became two quick chips (**Mine**, **Pending**) plus a **Filters** sheet with status, owner, due
  date, "behind baseline" and phase. Filters combine with AND; a line under the bar shows
  "Showing N of M" with Clear. Filters reset when the screen is left.
- **Baseline actions moved into a three-dot menu** on that bar (Lock baseline / Re-baseline,
  with the current baseline state). The menu is hidden for people who cannot change the baseline.

- **Bot conversation redesigned** (replaces the stacked full-width buttons of §8):
  - the whole conversation is one full-width column, so every card shares the same edges; bot
    text is a quiet line without an avatar;
  - one check-in is open at a time; the others are one-line rows ("Update") and the next one
    opens by itself after an answer;
  - progress is answered on a **scale** (25 · 50 · 75 · 90 · Done) with one tap; the part already
    reached is shaded. Problem, Not started and Note are neutral outlined buttons underneath;
  - no coloured buttons: state colour appears only as a small dot beside the answer;
  - an answered card is a single line; a reminder is a single line, not a second card;
  - a bar under the header shows "N tasks need an update · X of Y done".
- **Neutral work-chat palette (replaces §3.2).** The warm off-white surfaces and terracotta accent
  were replaced, at the owner's request, with the look of mainstream work-chat apps: white
  surfaces, grey hairlines and near-black text in light mode; charcoal surfaces in dark mode; one
  blue accent; muted status colours. All values are in `src/theme/colors.ts`; no component
  changed. The spec's rule against using another product's logo, name or brand colour still
  holds: the structure and neutrals follow the convention, the blue and the dark header are our own.

## Fixes after the code audit

- **Read markers:** a channel only marks messages read while its screen is on top, and the
  marker only ever moves forward.
- **Sync:** a full re-sync requested while another sync is running is no longer dropped, and a
  full re-sync keeps channels, DMs and projects that were created on the phone and not sent yet.
- **Direct messages** are created on the server with their first message. Opening a person's
  chat and leaving without writing creates nothing for either person.
- **Archived projects:** bot check-ins are refused by the server and their cards show no buttons.
- **Deleting a channel** also removes messages still queued for it.
- **Daily report date** uses local time (it used the UTC date, a day early before 05:30 IST).
- **Tests** (`npm test`, Jest via `jest-expo`): outbox lane ordering, task rules and permissions.
  These cover pure logic only; nothing that needs a phone or the database is tested.
- The schedule list and project settings were split into smaller files by job; unused code and a
  helper copied in three route files were removed.

## Translations

- English strings live next to their keys in code (`t('home.jumpTo', 'Jump to…')`) and
  `npm run i18n` generates `en.json` from them (dynamic keys are in `en.base.json`).
- Kannada and Hindi cover the worker flow: tabs, Home, chat basics, bot cards, My tasks, You,
  offline/unsent and all error messages (163 of 282 keys each). They are **demo translations**
  and need review by a native speaker. Everything else falls back to English.
- Manager/admin-only screens (schedule, task detail, project, members, dashboard) and the Demo
  panel use plain English text and are not yet routed through `t()`.
- Dates are formatted in English in all languages.

## What was verified, and how

Run in Expo Go on an Android 16 emulator (1080 × 2400), with `tsc --noEmit` and `expo lint` clean.

Checked end to end on the emulator: scenarios **1, 2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 15** of
§14, **16** (dark mode) on Home, My tasks, login and the Demo panel only, plus owner view of scenario 8, threads, the long-press menu, "create task from message", the
real gallery picker → upload → message chain, and cold restart.

Not exercised on a device:
- **4 (lanes)** — the runner and the upload slot are covered by scenario 3's upload-then-message
  run, but the "text in another channel overtakes the photo" race was not timed by hand.
- **8** for Ravi/Rohan in full (Ravi's missing `#qs` and manager controls were seen; Rohan's `#qs`
  relies on the seed and server filter).
- **14** (logout warning sheet) — code path only.
- Camera capture (the emulator has no real camera), Hindi screens, iOS, a physical low-end phone,
  and the 60 fps / 500-message target in §16.

## Accessibility pass (Apple HIG audit)

| Change | Why |
| --- | --- |
| Text scales up to 200% (`T` default `maxFontSizeMultiplier` 2). Caps remain only on fixed shapes: badges, avatars, OTP boxes, the check-in progress scale (1.6), segmented controls (1.5, then shrink to fit) | HIG asks for at least 200% text enlargement |
| At large text sizes (`useLargeText`, font scale ≥ 1.3) side-by-side layouts stack and labels wrap: key dates, dashboard rows and stats, task rows, check-in buttons, header subtitle | HIG: adapt layout to all font sizes, keep truncation to a minimum |
| Tab bar labels don't scale (`tabBarAllowFontScaling: false`) | Five labels can't fit at 200%; the system tab bars also keep their labels small |
| Stage stepper shows dots plus one line, "Stage 3 of 6 · Procurement"; dashboard pipeline is two rows of three | Six labels across a phone were 10 pt and shrank further |
| Contrast fixes: `textFaint`, light `warning`/`success`, dark `onAccent`; new `onColor` token | Several pairs were below 4.5:1 (text) or 3:1 (bold) |
| Task status uses shape as well as colour (alert icon for blocked, tick for done); late dates get an icon; rows have a full screen-reader label and "Mark done" / "Shift dates" accessibility actions | Don't convey information by colour alone; swipe-only actions were unreachable with VoiceOver/TalkBack |
| Touch areas reach 44 pt (via `hitSlop` where the drawn size is smaller) | HIG minimum hit region |
| iOS: no in-app theme switch (follows the system); back button is a chevron. Android keeps both as before | HIG: avoid an app-specific appearance setting; platform-familiar back control |
| Sheets skip their slide animation when Reduce Motion is on | Motion should be optional |
| Error copy no longer says "we"; task row text is translated | HIG writing guidance; CLAUDE.md translation rule |


## Sign-in by work email (2026-10-26)

The owner asked to sign in with the **work email** the company gives each person, instead of a
mobile number. The spec now says email everywhere it said phone.

| Change | Where |
|---|---|
| `User.phone` is now `User.email` (local `users.email` column too) | `src/types/models.ts`, `src/lib/db/schema.ts`, `src/lib/db/init.ts` |
| Login has one email field (email keyboard, no capitals, autofill as username); invalid address shows "Enter a valid work email" | `LoginScreen.tsx` |
| Code screen says "Sent by email to name@company.com"; the code is still `123456` | `OtpScreen.tsx` |
| Server finds the user by email, ignoring case and spaces; same generic reply for unknown addresses | `src/mock/routes/auth.ts`, `src/shared/schemas.ts` |
| Seed and demo accounts use `firstname@paliath.in`; the bot is `bot@siteline.app` | `seed.ts`, `demoUsers.ts` |
| The bot is recognised with `isBotUser()` everywhere, not a hard-coded number | Home search, New message, Add member |
| You tab shows the email under the name | `YouScreen.tsx` |

Not changed: there is no phone number on a person at all now. Kannada and Hindi have no sign-in
strings yet, so the sign-in screens stay in English in those languages, as before.

## Invite person (2026-10-26)

The spec left "adding people to the company" out of scope; the owner asked for it.

- **Where:** You → Company → **Invite person**, shown to the Owner and Admins only. Fields: name,
  work email and, for the Owner only, Member or Admin. Admins can invite Members only
  (`canInviteAs` in `src/shared/permissions.ts`, enforced by the server).
- **How it is saved:** like a new project. The person is added to the local directory at once and
  an `invite_user` item goes through the outbox to `POST /users`. If the server refuses, the local
  row is removed and the reason is shown.
- **Server:** new `POST /users` in `src/mock/routes/misc.ts`, idempotent by id. It adds the person
  to both company channels and creates their bot DM, so they start like everyone else. A duplicate
  email returns the new error `EMAIL_TAKEN` (409); the app also checks its local directory first,
  so the error shows straight away, even offline.
- **Not built:** removing or deactivating people, changing a person's role, resending an invite
  email (there are no real emails in the demo). Other signed-in people see the new person after
  their next sync, not live.

## People screen and deactivating people (2026-10-26)

- **People** (You → Company → People, route `app/people.tsx`): everyone in the company, searchable
  by name or email, deactivated people in their own section. Everyone can open it. Tapping a person
  shows their company role, their projects and a **Message** button.
- **Projects on a person:** a Member's phone only holds the projects that Member is on, so for a
  Member the list is labelled "Projects you share" and shows the overlap only. Owner and Admins see
  the full list.
- **Deactivate** ("archive, never delete"): Owner deactivates anyone except themselves; an Admin
  deactivates Members only; nobody deactivates the Owner (`canDeactivate`, enforced by the server
  at `POST /users/:id/deactivate`). The person's sessions end, they can't sign in (the sign-in
  screen shows the usual "code isn't right" message, so it doesn't reveal who has an account),
  and they disappear from Home search, New message, Add member and every task-owner picker. Their
  messages, tasks and history keep their name. Their email can be used for a new invite.
- **Saved like other changes:** local first, then the `deactivate_user` outbox item; a refusal
  restores the person and shows the reason.
- **Translated** the project Members screen (it was English-only), including Remove from project.
- **Not built:** reactivating someone, changing a company role, the Demo panel's "Who am I" still
  lists deactivated demo users (switching to one fails like a wrong code).

## Fully online app, FastAPI backend (2026-10-26)

The owner asked for a FastAPI mock backend that works like a real one, with a "dumb" app where
the backend does everything, and chose: **fully online, no local data**, FastAPI **replaces** the
in-app mock, build now.

**What changed**
- **New `backend/`** (FastAPI, Pydantic, uvicorn, pytest). In-memory store seeded from the same
  demo data, real HTTP routes, WebSocket live events, real photo uploads (saved to
  `backend/uploads/`), Demo panel controls under `/internal/*`. 37 tests cover the rules and routes.
- **All rules moved to the server** (`backend/app/rules.py`, `views.py`): permissions, task
  consequences (percent ↔ status, waiting for confirmation, actual dates), variance and project
  delay, unread counts, "My tasks" grouping, worker mode, default channels, edit/delete windows,
  message actions per viewer, who may deactivate whom, Activity read state. The app's
  `src/shared/permissions.ts` and `taskRules.ts` are deleted; only display helpers remain
  (`src/lib/format.ts`). Zod form schemas stay for instant feedback; the server checks again.
- **Removed from the app:** the SQLite database (`expo-sqlite`, `drizzle-orm`), the outbox, sync,
  the Unsent screen, "Send now", the logout warning about unsent changes, the outbox inspector
  and the in-app mock (`src/mock`). Reads are TanStack Query calls, one endpoint each; writes call
  the API and refresh what changed; WebSocket events say what is stale.
- **New endpoints** the thin app needs: `/me`, `/meta`, `/projects`, `/channels`,
  `/channels/:id/pins`, `/messages/:id/thread`, `/dms/:userId`, `/projects/:id/tasks`,
  `/tasks/:id`, `/tasks?ids=`, `/tasks/:id/shift`, `/me/tasks`, `/me/checkins`, `/activity` +
  `/activity/read`, `/projects/:id/updates`, `/projects/:id/files`, `/auth/logout`, multipart
  `/uploads` + `/files/:id`. `/sync` is gone.

**Behaviour that changed for the user**
- Without a connection the app shows "Can't reach Siteline"; screens already loaded stay visible,
  but nothing can be saved. A message that fails to send goes back into the composer.
- Error messages no longer promise automatic retries (en/kn/hi updated).
- Opening a DM creates it on the server; the server hides a DM with no messages from both
  people's lists, so the "no empty conversations" rule still holds.
- Own messages no longer show a clock/tick/red status icon: everything on screen is saved.
- Demo panel: server Online/Slow/Flaky + a "Phone offline" switch; the outbox and sync sections
  are replaced by "Refresh"; reset restarts the server data.

**Shortcuts (known limits)**
- One process, data in memory: a restart loses everything (by design for a demo).
- Uploaded files are served by an unguessable id without auth; a real deployment needs signed URLs.
- `/internal/*` has no auth; turn it off with `SITELINE_DEMO=0` anywhere public.
- The earlier "Invite person" and "Deactivate" notes above describe the outbox; they now call the
  API directly with the same rules.

## No dashboard; "My tasks" for everyone (2026-10-26)

The owner asked for five tabs only: **Home, DMs, My tasks, Activity, You**.
- The Owner/Admin **Dashboard** is removed: the tab, the `/dashboard` screen, the
  `GET /dashboard` endpoint, its test and the `dashboard.view` permission.
- The third tab is now **My tasks** for every role (tasks assigned to that person, from
  `GET /me/tasks`). Before, managers got a schedule list with a project switcher and Owner/Admin
  got the dashboard there; the switcher is removed.
- Managers still plan schedules in each project's **Tasks** tab (filters, quick add, swipe to
  shift, baseline), unchanged.

## Code audit fixes (2026-10-26)

- Asking for a new sign-in code no longer resets the 5-wrong-codes lock.
- A task's owner must be on its project when edited, not only when created.
- Photo links in messages always come from the server's own upload record; a message can't
  point phones at an outside address.
- Read markers are remembered per person, so a user switch can't leave unread badges stuck.
- Scripted teammates post only while someone has the app open.
- The app no longer fetches everything twice at sign-in.
- Removed dead leftovers of the offline design (sync fields, unused error list, a second
  directory hook, unused "is manager" arguments, a refresh banner that could never show).

## Send queue and saved screens (2026-10-27)

The owner asked for a properly built outbox after we compared Slack's approach. Built Slack-style:
the server still decides everything; the phone only holds changes until the server takes them.
- **Send queue** (`src/lib/outbox.ts`) for site actions only: messages with photos, check-in
  answers, task progress/status. Saved per user in AsyncStorage, survives closing the app, ids
  made on the phone (no duplicates), oldest first, photos upload once before their message,
  repeat task updates merge, retries 2/5/10/20 s, refusals become "Not sent" with Retry/Discard.
  6 tests in `src/lib/__tests__/outbox.test.ts` (order, retry, refusal, merge, photo once, restart).
- **Not built back:** a local database, rules on the phone, guessed results, or queueing for
  office actions (settings, members, invites) — those stay online-only. This keeps the gaps of
  the old outbox out (rules in two places, untested rollbacks).
- **Saved screens** (`src/lib/persist.ts`): last successful API replies saved per user for up to
  7 days and shown at app start; sign-in kept in SecureStore so the app opens signed in.
- Unsent screen, "Unsent items" on You, log-out warning and the offline banner's "N waiting" are back.
- Lists that fail to load now say so ("Couldn't load your tasks") instead of looking empty.
- New Expo Go packages: `@react-native-async-storage/async-storage`, `expo-secure-store`.

## Architecture cleanup (2026-10-27)

- **No import loops between features.** There were five (chat↔tasks, chat↔home, chat↔bot,
  projects↔home, projects↔members). The small pieces that caused them moved to
  `src/features/shared/` (was `shared.ts`): `isBotUser`, `byChannelOrder`, `useUnreadCounts`,
  `useRefresh`, `pickPhotos`, and sending a message (`sendMessage`, `extractMentions`).
  The activity feed hooks moved to `features/activity`. The `members` feature (one component and
  one screen, both for a project's Members tab) merged into `features/projects`.
  `src/features/__tests__/boundaries.test.ts` fails on any new loop or a feature import in shared.
- **Split by job:** `components/basics.tsx` (488 lines) → `components/basics/` with identity,
  controls, layout and states; `chat/components/forms.tsx` (372 lines) → one file per form plus
  shared parts. Both keep an `index.ts`, so imports didn't change.

## One job per file and folder (2026-10-27)

- **Backend:** business actions moved out of route files into `app/services/` — `messaging.py`
  (`post_message`), `tasks.py` (`apply_task_changes`, `recompute_project`, `set_baseline`),
  `people.py` (`deactivate_user`, `expire_access_tokens`). Routers now only translate HTTP, and the
  imports hidden inside functions to dodge circular imports are gone. Visibility checks moved out of
  `store.py` into `access.py`. `tests/test_layers.py` fails if anything but `main.py` imports a router.
- **App:** `lib/queries.ts` (reading) and `lib/mutations.ts` (online-only writes) are separate;
  `features/shared` is split into session, data and display; the Overview and Files tabs moved out of
  `ProjectScreen` (now a 67-line tab shell) and the New project sheet out of `HomeScreen`; message-list
  layout moved from `chat/hooks.ts` to `chat/messageList.ts`; `tasks/components/bits.tsx` renamed
  `TaskIndicators.tsx`.
- **Found while checking on the device:** the project Files tab returned a server error (an import
  inside a function still pointed at the old `store.py`; now fixed and tested), and the Files,
  schedule and Activity lists showed "nothing yet" when they had failed to load; they now say so.

## Second audit fixes (2026-10-27)

- **Reusing an id never leaks data.** Create routes (messages, tasks, projects, channels, people)
  check permission first, and return an existing record only for a real retry (same sender and
  channel, or same project). Any other reuse is `VALIDATION_FAILED` on `id`.
- **Messages are ordered by server time** (`createdAt`, then id), not by the client-made id. Unread
  counts, `before` paging and read markers all use that order; the app's "New" divider uses the
  channel's `lastReadAt`. A message from a phone with a wrong clock still counts as unread.
- **Send queue:** photos are copied into the app's document folder (`outbox/`) when queued, so the
  OS clearing its cache can't lose them; a missing file fails the item. An item that gets a server
  error 5 times is marked failed instead of blocking the queue forever. New Expo Go package:
  `expo-file-system`.
- **Server memory:** wrong-code locks expire after 15 minutes; refreshing a session drops its old
  access tokens; logout ends the session's tokens. Channel lists count unread in one pass.
- Smaller: a test for saved screens (`lib/__tests__/persist.test.ts`), one import path for
  `sendMessage` (`features/shared`), and `ProjectAccess` renamed `ProjectAccessInfo`.

## Frontend architecture review fixes (2026-10-27)

- **Language and theme are saved on the phone** (`stores/ui.ts`, zustand `persist`, key `prefs`), with
  the notification toggles and the hidden Demo button. Drafts and screen state are not saved. The
  splash screen waits for them (`prefsLoaded`), so the app never starts in the wrong language.
- **Two rules moved to the server:** "managers are in every channel" is `rolesInEveryChannel` in
  `/meta` (used by the member and channel editors), and "the Owner and Admins are never added to a
  project" is `joinsProjects` on each person, now also refused by `POST /projects/:id/members`.
  The app no longer checks a channel name for duplicates itself; the server's `CHANNEL_NAME_TAKEN`
  shows on the field.
- **Moved to where they belong:** invite and deactivate (`features/people/api.ts`, `InviteSheet`);
  `useProjectMembers` (`features/shared`, was in tasks); `ThreadScreen` (`features/chat`, the
  `threads` feature is gone); bot and Demo components into `components/` folders.
- **One `useRoleLabels`** (`shared/display.ts`) for Owner/Admin/Member, Manager/Member and job
  titles; message rows now show translated role chips.
- `src/shared` (zod schemas and error codes shared with the server) renamed `src/contract`, so it
  isn't confused with `src/features/shared`.

## Any industry; remaining logic moved to the server (2026-10-28)

- **No industry in code.** Stages, task phases, job titles (default channels, managers-only, simple
  mode), standard project channels, the channel task cards go to (`workChannel`) and problem types
  are the company's **setup** on the server (`S().company["setup"]`; Paliath's is `PALIATH_SETUP` in
  `seed.py`). Labels come in the reader's language: the app sends `Accept-Language`, `/meta`
  answers with labels. `rules.py` takes the setup as data; `tests/test_rules.py` runs the rules
  against an event-planning company to prove nothing assumes interior design.
- Removed from the app: the `STAGES`/`PHASES`/job-title lists, the channel order, stage colours by
  name (now by position), "Paliath Interiors" (now `GET /company`, public for the sign-in screen),
  the demo sign-in list (now `GET /auth/demo-accounts`, one per role), stage/job-title/problem
  translations in `kn.json`/`hi.json` (now in the setup). "Worker mode" is now `simpleMode`.
  Photo placeholder tones are plain colours (sand, stone, linen, sage).
- **Moved to the server:** schedule filtering (`GET /projects/:id/tasks?status=&owner=&due=&delayed=&phase=`,
  which also returns per-phase progress, phase choices, the current phase and the timeline window);
  new-task defaults (`GET /projects/:id/task-defaults`, and `POST` fills missing dates); project
  progress (`ProjectView.progress`) and `nextStage`; `TaskView.isDelayed`; channel display order
  (`GET /channels`). The app's DM list now follows the server's order (latest first) on Home too.
- **Trade-off:** a schedule filter the phone hasn't loaded before needs the connection.
- **Still in the app, on purpose:** the "Other" problem type (always offered, needs a note) and
  whether to show "Mark done" on a row (`access` permissions plus "is it my task").
- Not changed: the seed and scripted teammates (`seed.py`, `actors.py`) are Paliath's demo data, and
  the daily report still stores its head count as `workers`.

## Two top-level folders (2026-10-28)

- The Expo app moved into `frontend/` (app/, src/, assets/, scripts/ and its config); `backend/` is
  unchanged. Docs and project rules stay at the top. Run npm and npx inside `frontend/`;
  `npm run api` and `npm run test:api` there still start and test the server (`cd ../backend`).
