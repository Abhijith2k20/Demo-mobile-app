# Decisions and deviations from the spec

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
  - one check-in is open at a time; the others are one-line rows ("Update") and the next one
    opens by itself after an answer;
  - three main replies in one row (Done · In progress · Problem) with short labels; "Not started
    yet" and "Add a note" are small links underneath;
  - the open card shows the project, the due date (red when overdue) and current progress;
  - an answered card collapses to a single line; a reminder is a single line, not a second card;
  - a bar under the header shows "N tasks need an update · X of Y done";
  - check-in cards are full width with no sender header. The "You have N open tasks" message was
    removed because the bar says the same.

- **Dashboard redesigned** (changes §5.10): a headline ("Needs attention" / "Everything is on
  track"), four numbers, **every active project** with stage, progress and schedule health
  (not only the delayed ones), a "Blocked now" list, a six-cell pipeline in place of the
  segmented stage bar, and a compact "From site" feed. `GET /dashboard` now returns `projects`
  and `blockedTasks` instead of `delayedProjects`. Health is always an icon plus words, never
  colour alone.

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
