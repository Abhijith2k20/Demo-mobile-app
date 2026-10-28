# Siteline — Demo App Implementation Spec

> **Version 1.4 — send queue + saved screens.** Site actions (messages, photos, check-ins, task updates) wait in a send queue on the phone and go out when the server can be reached; the last loaded screens and the sign-in survive closing the app. Rules still live only on the server. See §12.4 and `DECISIONS.md`.

> **Version 1.3 — online app + FastAPI backend.** The app no longer keeps data on the phone: it talks to a FastAPI mock backend (`backend/`) that holds all data and all rules. See §10, §12 and `DECISIONS.md` ("Fully online app, FastAPI backend"). Version 1.2 text that described the local database, outbox and sync has been replaced.

> **Version 1.2 — updated to match the code.** This file describes the app as it is built today. Where the first version said something different, the text here has been changed; the reasons are in `DECISIONS.md`. Two planned changes are **not built yet**: parent/sub-tasks and areas, replacing phases (`docs/CHANGE_01_PARENT_SUBTASKS_AREAS.md`), and multi-tenancy, many companies on one Siteline (`docs/CHANGE_02_MULTI_TENANT.md`). Until Change 02 is built, the app supports one company.

> **For Claude Code.** Build a clickable, realistic **demo** of an internal project-communication app for an interior design company. It talks to a **FastAPI mock backend** (`backend/`, in-memory data, no real database) that runs on a laptop next to the phone. The goal is to *see and feel* the real product so the owner can make decisions. Read this whole file before starting. When something is unclear, choose the simplest option that keeps the architecture described here, and note it in `DECISIONS.md`.

---

## 0. What this demo must prove

1. **The experience:** Slack-style workspace navigation, channels per project, a DMs tab, chat, tasks with schedules, a button-based bot, in-chat forms and project settings, all simple enough for site workers.
2. **The architecture:** a **thin app** that shows what the server says (every permission, rule and calculation is on the server), a real HTTP API with a standard **error** format, live **events** over WebSocket, and **role-based permissions** enforced by the server. Replacing the mock backend with a production one means swapping its storage, not changing the app.
3. **Decision support:** a **Demo panel** lets the viewer switch user and role, slow the server down or cut the phone off, inject errors and trigger the bot, so every design decision can be seen in action.

4. **Any industry:** the app and server hold no industry's words. Each company has a **setup** on the server: its stages, task phases, job titles (with their default channels, which are managers-only, and which get the big-button **simple mode**), standard project channels, the channel task cards go to, and its problem types, with labels in each language. The demo company, Paliath Interiors, uses an interior-design setup (`backend/app/seed.py`, `PALIATH_SETUP`); the stages, job titles and channels named in this spec are that setup's values, not rules in code.

**Not in scope:** a production server (database, deployment), real login, real push notifications, real file storage, iOS-specific polish, production security.

---

## 1. Hard constraints

- **Must run in Expo Go** (no custom native modules, no dev build required). Every library below is Expo Go compatible.
- **TypeScript strict mode.** No `any`.
- **Android first.** Test on a mid/low-end Android phone. Smooth scrolling is a requirement.
- **Light and dark mode**, following the system setting.
- **Needs the backend.** The phone must reach the FastAPI server (same Wi-Fi as the laptop, or `adb reverse` on the emulator). Without it the app shows the last loaded screens, and messages, photos, check-ins and task updates wait in the send queue; other changes need the connection.
- **No borrowed branding.** The layout, density and neutral palette follow mainstream work-chat apps such as Slack (see §3), but do **not** use Slack's logo, name, brand purple, icon set, illustrations or copy.

---

## 2. Tech stack

| Concern | Library |
|---|---|
| Framework | Expo (latest stable SDK), React Native, TypeScript |
| Navigation | `expo-router` (file-based) |
| Server data | `@tanstack/react-query` (every screen; live events mark queries stale) |
| Backend | Python 3.13, FastAPI, Pydantic, uvicorn; tests with pytest (`backend/`) |
| App-only state | `zustand` |
| Lists | `@shopify/flash-list` v2 (no `inverted` prop; chat uses `maintainVisibleContentPosition` with `startRenderingFromBottom`) |
| Bottom sheets | Own `Sheet` component (`src/components/Sheet.tsx`): React Native `Modal` + `react-native-reanimated` + `react-native-gesture-handler`. `@gorhom/bottom-sheet` is **not** used: it does not open on Expo SDK 57. |
| Forms | `react-hook-form` + `zod` |
| Images | `expo-image`, `expo-image-picker` |
| IDs | `uuidv7` (pure JS) |
| Dates | `date-fns` |
| i18n | `i18next` + `react-i18next` (English full; Kannada and Hindi for the worker flow only) |
| Icons | `@expo/vector-icons` (Feather set only, for consistency) |
| Fonts | `@expo-google-fonts/inter` (Inter 400/500/600/700) |
| Haptics | `expo-haptics` (light tap on send, success on task done) |
| Clipboard | `expo-clipboard` ("Copy text") |
| Tests | app: `jest` + `jest-expo` (`npm test`, task filters); backend: `pytest` (rules, permissions, every route) |
| Lint | `eslint` 9 + `eslint-config-expo` (`npm run lint`) |

Built on **Expo SDK 57** (React Native 0.86, React 19.2, Reanimated 4.5). `.npmrc` sets `legacy-peer-deps=true`.

**Server data:** kept in memory by the backend and rebuilt from the seed (§11) on start and on "Reset demo". Photos are saved under `backend/uploads/`.

---

## 3. Design language

### 3.1 Direction

**Information architecture and density inspired by Slack mobile:** a workspace home made of collapsible sections, compact channel rows with bold-when-unread names, left-aligned message rows (avatar, name, time, text — not bubbles), threads, and interactive "block"-style cards in the message stream.

**Visual style: neutral work-chat.** White surfaces, grey hairlines and near-black text in light mode; charcoal surfaces in dark mode; one blue accent; a dark blue-grey workspace header. Status colours are muted: colour marks state, it does not decorate. Generous touch targets for site workers.

Name: **Siteline**. Company in seed data: **Paliath Interiors**.

### 3.2 Colour tokens

Define in `src/theme/colors.ts` with light and dark values. Never hard-code colours in components.

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
| `textFaint` | `#6E7074` | `#979A9E` | Placeholders, hints, timestamps (≥4.5:1 on its surfaces) |
| `accent` | `#1667B0` | `#4A9FE0` | Primary buttons, unread badges, links, active states |
| `accentSoft` | `#E8F1F9` | `#1B2E40` | Accent backgrounds (selected chip, mention highlight) |
| `onAccent` | `#FFFFFF` | `#0E1A26` | Text/icons on accent (dark ink in dark mode: white on `#4A9FE0` is 2.87:1) |
| `onColor` | `#FFFFFF` | `#FFFFFF` | Text on fixed colours: avatars, photo overlays |
| `success` | `#2A7253` | `#5FB58C` | Done, sent ticks, on-track |
| `successSoft` | `#E6F2EC` | `#1B2F26` | |
| `warning` | `#87600F` | `#D6A64F` | At risk, waiting, retrying |
| `warningSoft` | `#FBF2DE` | `#332A17` | Offline banner |
| `danger` | `#B8423A` | `#E0736A` | Failed, delayed, destructive |
| `dangerSoft` | `#FBEAE8` | `#38201E` | |
| `info` | `#2F6F99` | `#6FA9CC` | Stage pills, sending state |
| `infoSoft` | `#E6F0F6` | `#1A2A35` | |
| `execution` | `#5E55A6` | `#A39BDD` | Execution stage pill |
| `executionSoft` | `#ECEAF6` | `#28253D` | |
| `scrim` | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.6)` | Behind sheets |

**Avatar colours:** 8 muted earthy tones (clay, sage, slate, ochre, plum, teal, sand, rust), picked deterministically from the user ID. Initials in white, 600 weight.

**Project stage colours** (pill background / text): Design → `infoSoft/info`, Approval → `accentSoft/accent`, Procurement → `warningSoft/warning`, Execution → `executionSoft/execution`, Finishing → `successSoft/success`, Handover → `surfaceAlt/textMuted`.

### 3.3 Typography (Inter)

| Style | Size / line height | Weight | Use |
|---|---|---|---|
| `display` | 28 / 34 | 700 | Large numbers (rarely used) |
| `title` | 20 / 26 | 700 | Screen titles, workspace name |
| `heading` | 17 / 22 | 600 | Channel name in header, card titles |
| `body` | 16 / 23 | 400 | Messages, form inputs |
| `bodyStrong` | 16 / 23 | 600 | Sender names, unread channel names |
| `meta` | 13 / 18 | 400 | Timestamps, subtitles |
| `label` | 12 / 16 | 600, uppercase, letter-spacing 0.6 | Section headers ("PROJECTS"), field labels |
| `metaStrong` | 13 / 18 | 600 | Small emphasised text, chips |
| `button` | 16 / 22 | 600 | Button labels |

Simple mode (job titles the company marks `simpleMode`; Paliath: Worker) bumps `body` to 17 and buttons to 18.

### 3.4 Spacing, shape, elevation

- 4-pt grid: `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32`. Screen side padding 16.
- Radii: inputs/buttons 10, cards 14, sheets 20 (top corners), pills 999, avatars 8 (rounded square, not circles — part of our identity).
- Elevation: almost flat. Cards use a 1 px `border`; only bottom sheets and the floating Demo pill get a soft shadow.
- Minimum touch target 44 × 44 (48 × 48 for worker check-in buttons).

### 3.5 Motion

- 150–220 ms ease-out for presses, sheet opens, row expansion. No bouncy springs.
- New incoming message: fade + 8 px slide up.
- Respect "reduce motion".

### 3.6 Iconography

Feather icons only, 20 px in rows, 22 px in headers/tab bar, 1.75 stroke look. Channel rows use `#` text glyph (not an icon) for public channels and Feather `lock` for private.

### 3.7 Signature details (what makes it feel crafted, not generic)

- **Workspace header** in dark blue-grey with the company name, a small square company logo tile (initials "PI" on the accent colour), and a search field below it.
- **Stage banner** at the top of every project channel: a thin bar showing the 6 stages as segments, current stage filled, with "Execution · 4 days behind baseline" text. Tapping opens the project.
- **Message grouping:** consecutive messages from the same sender within 5 minutes collapse (no repeated avatar/name). Day dividers ("Today", "Yesterday", "Mon 6 Oct") as centred `label` text with hairlines.
- **"New" divider** in accent colour above the first unread message.
- **Photo grids** like a site log: 1 photo full-width (4:3), 2 side by side, 3–4 in a 2 × 2 grid, more shows "+N".
- **Cards in chat** (task, issue, daily report, status) look like structured blocks with a left accent rule, title and context line. **Bot check-in cards** are different: see §8.

---

## 4. Navigation structure

```
app/                          ROUTES ONLY: each file reads URL params and renders a screen
  _layout.tsx                 Providers, theme, fonts, DB init, auth gate, Demo pill
  (auth)/
    _layout.tsx
    login.tsx                 → features/auth/screens/LoginScreen
    otp.tsx                   → features/auth/screens/OtpScreen
  (app)/
    _layout.tsx               Bottom tabs
    index.tsx                 → features/home/screens/HomeScreen
    dms.tsx                   → features/chat/screens/DmsScreen
    tasks.tsx                 → features/tasks/screens/TasksTabScreen (role-aware)
    activity.tsx              → features/activity/screens/ActivityScreen
    you.tsx                   → features/profile/screens/YouScreen
  channel/[id].tsx            → features/chat/screens/ChannelScreen
  thread/[messageId].tsx      → features/chat/screens/ThreadScreen
  dm/[userId].tsx             → features/chat/screens/DmScreen (`/dm/bot` is the Siteline Bot)
  project/[id]/index.tsx      → features/projects/screens/ProjectScreen (Overview, Tasks, Members, Files)
  project/[id]/settings.tsx   → features/projects/screens/ProjectSettingsScreen
  project/[id]/members.tsx    → features/members/screens/MembersScreen
  task/[id].tsx               → features/tasks/screens/TaskDetailScreen
  people.tsx                  → features/people/screens/PeopleScreen
  demo.tsx                    → features/demo/screens/DemoPanelScreen (modal)
```

Tab files are `index`, `dms`, `tasks`, `activity`, `you` (not `(home)/index` etc.): several `index` routes in sibling groups would all map to `/`.

**Bottom tabs:** Home, DMs, My tasks, Activity, You — the same five for every role. There is no dashboard. Tab bar on `surface`, active tint `accent`. Unread badges: Home counts channel messages only, DMs counts direct messages, Activity counts unseen items.

---

## 5. Screens

### 5.1 Login and OTP (mock)

Both screens share one layout (`AuthShell`): the dark header with the logo tile, "Paliath Interiors" and "Siteline workspace", over a rounded card that holds the form. The Demo pill is hidden on these two screens.

- **Login:** title "Sign in", one large **work email** field (email keyboard, no auto-capitalise), primary button **Continue** (enabled once something is typed; an invalid address shows an inline error). At the bottom, a link **"Use a demo account"** opens a sheet listing the 7 demo users (avatar, name, role/title); picking one goes straight to the code screen. A help line: "Can't sign in? Ask your company admin to add your work email."
- **OTP:** six boxes in two groups of three, fed by one hidden input (so paste and autofill work), the email address shown with a **Change** link, "Resend in 0:28" countdown then **Resend code**. Signs in automatically on the sixth digit. Code for every demo user is **`123456`**. Wrong code → inline red error from `OTP_INVALID`; 5 wrong attempts → `OTP_TOO_MANY_ATTEMPTS`.
- On success: tokens stored in memory/zustand (secure storage not needed in demo), run first **sync**, go to Home.

### 5.2 Home (workspace)

Top to bottom:
1. **Workspace header:** logo tile, "Paliath Interiors", chevron; search field ("Jump to…") filtering channels, people and projects locally. Picking a person opens their DM.
2. **Offline banner** (only when the server can't be reached): `warningSoft`, "Can't reach Siteline. Check your connection; changes need it to save."
3. **Sections** (collapsible, state remembered in zustand):
   - **PROJECTS** — one collapsible row per active project the user can see: project name (`bodyStrong` if any unread), stage pill, delay indicator (red dot + "4d" if behind baseline). Expanded: its channels indented (`# general`, `# design`, `# site-work`, `🔒 qs`, then custom channels by name), unread badge on the right, bold name when unread, and a **Project overview** row.
   - **Archived (N)** — collapsed group under the active projects, shown only when the user has archived projects.
   - **COMPANY** — `# announcements` (read-only for Members: composer replaced by "Only admins can post here"), `# general`.
4. **Floating action button** (accent, bottom-right): **New project**, Owner/Admin only. ("New message" lives on the DMs tab.)

Direct messages are **not** on Home; they have their own tab (§5.14). Pull-to-refresh runs sync. Rows are 44 px tall.

### 5.3 Channel conversation

- **Header:** back, `# site-work` (`heading`), subtitle "Villa 99 · 6 members", right icons: search (stub), info (opens the channel details sheet: public/private note, members, pinned items, and **Channel settings** for Managers or **Leave channel** for Members, except in `#general`).
- **Stage banner** (project channels only), see §3.7.
- **Message list** (FlashList, inverted, reads from local DB via `useLiveQuery`, latest 50, loads older on scroll):
  - Message row: 36 px rounded-square avatar, name (`bodyStrong`) + job title chip (tiny `label`) + time (`meta`), body text, attachments, reactions row, "3 replies · Last reply 2h ago" thread link.
  - Long-press menu (bottom sheet): React (6 quick emoji), Reply in thread, Copy text, **Create task from message**, Edit (own, within 15 min), Delete (own within 1 h; Managers any), Pin (Managers).
  - Renderer registry by `type` (see §7.4). Unknown type → "Update the app to see this message."
- **Composer:** rounded input on `surfaceAlt`, left **"+"** button, right **send** (accent when text present, else mic for voice note).
  - **"+" sheet** grid: Camera, Gallery, Voice note, File, **New task**, **Report issue**, **Daily report**. Each with a 48 px icon tile. Voice note and File are **simulated** in the demo (a recording timer; a sample PDF).
  - **Simple mode:** a large camera button sits left of the input (48 px, accent outline).
- **Read-only channels** show a muted bar instead of the composer. So does every channel of an **archived project** ("This project is archived. It is read-only.").
- Messages are marked read only while the channel is on top and the app is in the foreground.

### 5.4 Thread

Parent message at top (full), divider "12 replies", replies list, composer. Option "Also send to #site-work" checkbox.

### 5.5 Direct message

Same as channel without stage banner. A new DM exists only on the phone until its first message is sent; opening a person's chat and leaving without typing creates nothing. The **Siteline Bot** DM is where check-ins appear and has its own layout (see §8).

### 5.6 Project overview (`project/[id]`)

Segmented control: **Overview · Tasks · Members · Files**.

- **Overview:** project name (`title`), client and address (`meta`), **stage stepper** (6 steps horizontal, current highlighted; Managers can tap "Move to next stage" → confirmation sheet), key dates card (start, planned finish, baseline finish, "4 days behind"), progress ring (% of tasks done), "Channels" list with **Browse channels** (join public channels you are not in) and, for people who can manage the project, a **Project settings** row, then "Recent updates" (last 5 status cards). A gear in the header also opens Project settings (§5.15). Archived projects show a read-only banner.
- **Tasks:** same component as §5.7 scoped to the project.
- **Members:** list with avatar, name, **role badge** (Manager / Member), job title, channels. Managers see "Add member" and can edit role/job title/channels (§5.11).
- **Files:** grid of all photos and files from the project's channels, newest first.

### 5.7 My tasks tab (everyone) and the project schedule

The **My tasks** tab is the same for every role: the tasks assigned to the signed-in person (details below). Schedule work happens inside each project's **Tasks** tab (`project/[id]`, §5.6):

**Project schedule (project → Tasks):**
- **Toolbar:** two quick chips, **Mine** and **Pending** (everything not finished), a **Filters** button with a count of active filters, and a **three-dot menu** on the right. When any filter is on, a line shows "Showing 3 of 18 tasks" with **Clear**.
- **Filters sheet:** Status (multi-select), Owner (Me, Unassigned, or one person), Due (Any time, Overdue, Next 7 days, Next 30 days), Schedule (Behind baseline; only when a baseline exists), Phase (multi-select). Filters combine with AND. The button reads "Show N tasks". Filters reset when the screen is left. Logic is in `features/tasks/filters.ts` (tested).
- **Three-dot menu** (only for people who may change the baseline): shows the baseline state and **Lock baseline** (with confirmation) or **Re-baseline** (asks for a reason, logged in `#general`).
- Grouped by **phase** (Civil, Electrical, Plumbing, False ceiling, Carpentry, Painting, Finishing, Handover, plus any custom phase) with sticky phase headers showing "3/7 done".
- **Task row:** status dot, name, owner avatar (20 px), date range `meta` ("18–21 Oct"), a thin **mini timeline bar** showing planned span vs baseline (baseline as a faint outline, planned as solid; red if planned finish > baseline finish), % on the right.
- **Quick-add bar** pinned at bottom: a phase chip (tap to change) and "Add a task…"; enter creates a task with smart defaults (starts the day after the previous task in that phase ends, 3 days long, owner unassigned).
- Swipe right: mark done (Managers: confirmed; Members: "done — awaiting confirmation"). Swipe left: shift dates (sheet with −1/+1/+3/+7 days).

**"My tasks"** (the tab, for everyone; grouped by the server, `GET /me/tasks`).
- Greeting "Good morning, Ravi" and date.
- **Today** card list: big rows (task name `heading`, project, due), each with three large buttons: **Started**, **Update %**, **Problem**.
- "This week" and "Done recently" sections.
- Tasks in archived projects are not listed.
- **Problem** sets the task to Blocked and posts an issue card in the task's channel.
- No baseline or variance shown.

### 5.8 Task detail (`task/[id]`)

Presented as a full-height bottom sheet. Dates are picked in a **calendar sheet** (month grid, today ringed, Today / Tomorrow / In a week shortcuts, days before the allowed minimum greyed out).
- Name (editable by Managers), project › phase breadcrumb, status selector (Not started / In progress / Blocked / Done), % slider snapping to 0/25/50/75/90/100 (save on release).
- Owner picker (project members only).
- **Dates block:** Planned start/finish (editable by Managers), Baseline start/finish (read-only, lock icon), Actual start/finish (auto), and a **variance chip** ("+4 days").
- Linked channel and "Discuss in #site-work" button.
- **History timeline:** every change with who, what, when ("Amit changed finish 24 Oct → 26 Oct · 2h ago"; "Ravi set progress to 75% · via check-in").
- Members who can't edit see fields as read-only text, not disabled inputs. Non-managers do not see baseline or variance.

### 5.9 Activity

Mentions, thread replies, task assignments, task changes and check-in results, newest first. **Batched** task-change items ("Amit changed dates on 20 tasks in Villa 99 · 3 are yours"), expandable. Unread items have an accent left rule.

### 5.10 Dashboard

Removed (2026-10-26): the owner decided the app doesn't need one. Project health is on Home (stage pill, days behind) and on each project's Overview.

### 5.11 Manage members (Managers)

- List of project members; "Add member" opens a sheet: search company directory → choose **Role** (Manager / Member, segmented) → choose **Job title** (Designer, QS, Supervisor, Worker) → shows **default channels** that will be joined (checkboxes pre-ticked per §9.3, editable) → Add.
- Edit and remove members. Removing shows: "Ravi will lose access to this project. Their messages stay."
- Choosing **Manager** ticks every channel: managers are always in every channel of their project.

### 5.12 You

Avatar, name, work email, company role, list of projects with project role + job title. A **Company** section with **People** (everyone: search by name or email; tap a person for their role, projects — Members see only projects they share — and **Message**; the Owner and Admins also get **Deactivate**, with a confirmation; deactivated people are listed separately) and, for Owner/Admin only, **Invite person** (name, work email, and for the Owner a Member/Admin choice); the person can sign in with that email straight away and starts with both company channels and a bot DM. An email already in use shows "Someone already uses this email." Settings: Language (English / ಕನ್ನಡ / हिंदी), Theme (System/Light/Dark), Notifications (stub toggles), **Show the Demo button** (when hidden), **Log out** (signs out on the server too).

### 5.13 Unsent (`unsent.tsx`)

Opened from You → **Unsent items** (badge: refused count in red, else waiting count). Lists send-queue items: **Not sent** (the server refused; reason in plain words) and **Waiting to send**. Each row says what it is ("Message in #site-work: “Starting POP…”", "Check-in: False ceiling – living room", "Task update: …") with **Retry** (refused) and **Discard** (asks first). "Try sending now" retries all waiting items. Log out with items in the queue asks first: "3 changes haven't been sent yet. Logging out deletes them." 

### 5.14 DMs tab

- Header "Direct messages" with a search field ("Find a conversation").
- **Siteline Bot** first, then people ordered by most recent message. Each row: avatar with presence dot, name, last-message preview (a readable label for photos, voice notes and cards; "You:" for own messages), time, unread badge.
- Floating button **New message**: a sheet listing the company directory (TanStack Query against `GET /users`, local users shown first).

### 5.15 Project settings (`project/[id]/settings`)

For Managers, Owner and Admin. Reached from the gear in the project header, the "Project settings" row on the overview, and "Channel settings" inside a channel.

- **Details:** project name, client, site address (editable; Save appears once something changes).
- **Channels:** list with public/private and member count. Tap a channel to edit: name (lowercase letters, numbers, hyphens), **Private channel** switch, and who is in it. **Delete** sits beside the title in this editor and nowhere else. **Add channel** creates a new one (starts public with everyone ticked).
- **People:** a row that opens Manage members (§5.11).
- **Project:** one card with **Archive project** (confirm; becomes **Unarchive project**) and **Delete project** (Owner/Admin only; the user must type the project name).

Rules: `#general` cannot be renamed, made private, deleted or left. Managers cannot be unticked from a channel. See §9.5 for what public, private and archived mean.

---

## 6. Forms inside chat (bottom sheets)

All built with react-hook-form + zod; schemas mirror the backend. Pre-fill project, channel and today's date. Submitting sends the form to the server and posts a **card message** to the channel.

| Form | Fields | Result card |
|---|---|---|
| **New task** | Name*, Phase (picker), Owner (project members), Planned start/finish (calendar sheet, finish ≥ start), Description | Task card |
| **Report issue** | What's wrong* (preset chips: Material not arrived, Waiting for design, Labour short, Damage, Other + text), Photos (0–4), Related task (optional), Urgency (Normal/Urgent) | Issue card (danger accent) and, if Urgent, a mention of the project Managers |
| **Daily report** | Work done today*, Workers on site (stepper), Photos (0–6), Problems (optional), Tomorrow's plan | Daily report card |

Validation errors show under the field, in red `meta` text.

---

## 7. Data model (API)

### 7.1 Types (`src/types/models.ts`)

```ts
type ID = string; // UUIDv7

type CompanyRole = "owner" | "admin" | "member";
type ProjectRole = "manager" | "member";
type JobTitle = "Project Manager" | "Designer" | "QS" | "Supervisor" | "Worker";
type Stage = "design" | "approval" | "procurement" | "execution" | "finishing" | "handover";

interface User { id: ID; name: string; email: string; companyRole: CompanyRole; avatarColor: string; isActive: boolean;
  online?: boolean; /* presence dot (demo) */ }
interface Project { id: ID; companyId: ID; name: string; client: string; address: string; stage: Stage;
  startDate: string; plannedFinish: string; baselineFinish: string | null; baselineLocked: boolean;
  archivedAt: string | null; /* set = read-only */ updatedAt: string; }
interface ProjectMember { projectId: ID; userId: ID; role: ProjectRole; jobTitle: JobTitle; }
interface Channel { id: ID; companyId: ID; projectId: ID | null; name: string;
  kind: "project" | "company" | "dm" | "bot"; isPrivate: boolean; postingPolicy: "everyone" | "admins"; updatedAt: string; }
interface ChannelMember { channelId: ID; userId: ID; lastReadMessageId: ID | null; }

type MessageType = "text" | "image" | "voice" | "file" | "task_card" | "checkin" | "issue_card"
  | "daily_report" | "status_card" | "system";
interface Message { id: ID; channelId: ID; senderId: ID; type: MessageType; body: string | null;
  data: Record<string, unknown> | null; threadParentId: ID | null; reactions: Record<string, ID[]>;
  status: "sent"; createdAt: string; updatedAt: string; deletedAt: string | null; }

type TaskStatus = "not_started" | "in_progress" | "blocked" | "done" | "done_pending_confirmation";
interface Task { id: ID; projectId: ID; phase: string; name: string; description: string | null; ownerId: ID | null;
  plannedStart: string; plannedFinish: string; baselineStart: string | null; baselineFinish: string | null;
  actualStart: string | null; actualFinish: string | null; status: TaskStatus; percent: number;
  channelId: ID | null; updatedAt: string; deletedAt: string | null; }
interface TaskHistory { id: ID; taskId: ID; userId: ID; field: string; from: string | null; to: string | null;
  via: "app" | "checkin" | "system"; createdAt: string; }
interface Checkin { id: ID; taskId: ID; userId: ID; askedAt: string; answer: null | {
  kind: "started" | "progress" | "problem" | "done" | "not_started"; percent?: number; reason?: string;
  note?: string; voiceSec?: number; hasPhoto?: boolean; at?: string }; }

// Photos inside message.data.attachments
interface Attachment { id: ID; kind: "image"; uri: string | null; uploadId: ID | null; caption?: string;
  tone?: "plywood" | "concrete" | "tile" | "sage"; }

// Items on the Activity screen (sent by sync and by the `activity.new` event)
interface Activity { id: ID; userId: ID; kind: "mention" | "thread_reply" | "task_assigned" | "task_changes"
  | "checkin_result" | "escalation"; actorId: ID; projectId: ID | null; channelId: ID | null;
  messageId: ID | null; taskIds: ID[]; text: string; lines: string[]; createdAt: string; }
```

### 7.2 Fields the server adds for the viewer

The app never works these out; they come with every reply (`src/types/models.ts`):

| Type | Extra fields |
|---|---|
| `ProjectView` | `delayDays` (behind/ahead of the locked baseline), `members`, `access: { role, jobTitle, permissions[] }` |
| `ChannelView` | `memberIds`, `peerId` (DM), `joined`, `unreadCount`, `lastReadMessageId`, `lastMessage`, `canPost` |
| `MessageView` | `replyCount`, `lastReplyAt`, `canEdit`, `canDelete`, `canPin` |
| `TaskView` | `varianceDays`, `isLate` |
| `UserView` | `canDeactivate` (for this viewer) |
| `ActivityView` | `read` (read state is kept on the server, per user) |
| `GET /me` | `permissions[]` (company level: `company.users`, `project.create`, `user.invite`, `user.invite_admin`), `simpleMode` |
| `GET /meta` | the company's setup in the reader's language (`Accept-Language`): stages, phases, job titles, default job title, problem types, default channels; plus `percentSteps` and edit/delete windows |

Message `data` flags: `edited`, `pinned`, `mentions` (user ids), `alsoToChannel` (thread reply also shown in the channel), `attachments` (photos: `uri` is the server URL, `uploadId` the upload).

### 7.4 Message renderer registry

```ts
const renderers: Record<MessageType, React.ComponentType<{ message: Message }>> = {
  text: TextMessage, image: ImageMessage, voice: VoiceMessage, file: FileMessage,
  task_card: TaskCard, checkin: CheckinCard, issue_card: IssueCard, daily_report: DailyReportCard,
  status_card: StatusCard, system: SystemNotice,
};
```

---

## 8. The bot (Siteline Bot)

- Lives in a DM channel of kind `bot` with every user. The conversation is **one full-width column** (no avatars), so every card shares the same edges.
- **Opening the conversation asks about every open task the user owns** (`POST /bot/checkins`). Tasks asked about in the last 12 hours are skipped. Tasks in archived projects are never asked about.
- **Progress bar under the header:** "3 tasks need an update · 0 of 3 done", then "All caught up. Thanks!".
- **One question at a time:** only the oldest unanswered check-in is open. The others are one-line rows with **Update**; tapping one opens it instead. After an answer the next one opens by itself.
- **The open card:** task name, "Villa 99 · due Sun 11 Oct" (red "Overdue" when late), its place in the queue ("1 of 3"), then:
  - a **progress scale** `25% · 50% · 75% · 90% · Done`. The part already reached is shaded with a thin accent line. Tapping a stop answers in one tap.
  - three neutral outlined buttons: **Problem**, **Not started**, **Note**.
  - **Problem** swaps the scale for the reasons: Material not arrived · Waiting for design · Labour short · Other.
  - **Note** opens a text field with a microphone (recording is simulated: a timer) and "Add a photo". The note is sent with whichever answer is tapped.
- **No coloured buttons and no emoji.** State colour appears only as a small dot beside an answer.
- **Answered card:** one line, e.g. "False ceiling – living room · ● 75% · 6:04 PM", with the note underneath if there is one.
- Each answer → `POST /checkins/:id/answer` (safe to repeat) → the server updates the task, writes history "via check-in", posts a **status card** in the project's `#site-work` ("Ravi · False ceiling – living room → 75%", with the note) and an Activity item for the managers. "Not started" changes nothing on the task.
- **Morning summary:** a small table, "Good morning, Ravi · 2 today", one row per task with due date and progress; rows open the task.
- **Reminder** if unanswered after (demo) 60 s: a single quiet line, not a second card. **Escalation** status card to the Managers after another 60 s: "Ravi hasn't updated False ceiling." The batch asked on open carries no reminder timer; the Demo panel's single evening check-in does.
- Demo panel buttons trigger "Send morning summary", "Send evening check-in" and "Trigger escalation" for the current user immediately.

---

## 9. Roles and permissions

### 9.1 Model

- Company roles: **Owner**, **Admin**, **Member**. Owner/Admin see every project and channel (but **never other people's DMs**).
- Project roles: **Manager**, **Member**. Job title is a label that sets default channels only.

### 9.2 Permission map (server only)

`backend/app/rules.py` is the only place permissions live. The server **enforces** them on every route and **tells** the app what the viewer may do (`access.permissions` on each project, `permissions` on `/me`, `can*` flags on messages and people). The app only shows or hides controls from those answers.

```python
PROJECT_PERMISSIONS = {
  "manager": ["project.edit", "project.stage", "project.members", "channel.manage", "task.create",
              "task.edit_any", "task.update_for_others", "task.confirm", "task.baseline",
              "message.delete_any", "message.pin"],
  "member":  ["task.create", "task.update_own"],
}
# Owner/Admin may do every project action. An archived project only allows project.archive
# (to unarchive) and, for Owner/Admin, project.delete.
```

Company-level actions are Owner/Admin only (adding an Admin: Owner only). Posting in `postingPolicy: "admins"` channels is Owner/Admin only.

### 9.3 Default channels by job title

From the company's setup (Paliath's below). Managers are always in every channel (`rolesInEveryChannel` in `/meta`).

| Job title | Default channels |
|---|---|
| Any Manager | all project channels |
| Designer | design, general |
| QS | qs, general |
| Supervisor, Worker | site-work, general |

### 9.4 Universal rules

Edit own message ≤ 15 min; delete own ≤ 1 h ("This message was deleted"); DMs private to the two people; removal from a project ends access (channels disappear on next sync/event); members marked Member can mark own task done → `done_pending_confirmation` until a Manager confirms.

### 9.5 Channels and projects

- **Public channel:** anyone on the project can find it under "Browse channels" and join; Members can leave again.
- **Private channel:** only the people a Manager ticks can see it. Others cannot find or join it.
- **Managers are in every channel of their project** and cannot be removed from one or leave one. Owner/Admin see every project channel, private or not.
- `#general` cannot be renamed, made private, deleted or left.
- Creating, renaming, deleting channels and changing who is in them needs `channel.manage`; editing project details and archiving needs `project.edit` (both Manager).
- **Archived project:** read-only for everyone. No new messages, task changes, channel changes or check-ins (`409 PROJECT_ARCHIVED`); the app hides every editing control. It moves to "Archived" on Home and is left out of My tasks and bot check-ins. Nothing is deleted; a Manager can unarchive.
- **Deleting a project** is Owner/Admin only and removes its channels, messages, tasks and memberships for everyone.
- Deleting a channel removes its messages for everyone (no channel archive in the demo).

Not built yet: adding people to the **company** (`company.users`). The demo only has the seeded people.

---

## 10. Backend (FastAPI mock)

### 10.1 Shape

A real HTTP server with in-memory data. It owns every rule; the app is a thin client.

```
backend/
  app/main.py        app, error format, network simulation, WebSocket /ws, reset
  app/rules.py       permissions, task rules, dates (the only copy)
  app/store.py       in-memory data and lookups
  app/access.py      who may see and change what (404 for hidden records, event audiences)
  app/views.py       what a record looks like to a viewer (computed fields, §7.2)
  app/schemas.py     request validation (Pydantic)
  app/seed.py        all demo data (§11)
  app/routers/       HTTP only: auth, me, people, projects, channels, messages, tasks, uploads, internal
  app/services/      business actions shared by routes, the bot and teammates: messaging, tasks, people
  app/events.py      WebSocket hub (events go only to the users named) + timers
  app/bot.py         check-ins, reminders, escalation, morning summary
  app/notify.py      Activity items and 10 s batching of task changes
  app/actors.py      scripted teammates (§10.6)
  app/netsim.py      Demo panel network conditions and error injection
  tests/             pytest: rules, permissions, every route, layering (only main.py imports routers)
```

Run: `cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000`. Data resets on restart or **Demo panel → Reset demo**. `SITELINE_DEMO=0` hides the `/internal` routes; `SITELINE_ACTORS=0` turns the scripted teammates off. Interactive API docs: `http://<host>:8000/docs`.

### 10.2 Endpoints

| Method & path | Notes |
|---|---|
| `POST /auth/otp/request` `{email}` | Always "sent"; same answer for unknown addresses |
| `POST /auth/otp/verify` `{email, code}` | `123456` → `{accessToken, refreshToken, user, permissions, workerMode}` |
| `POST /auth/refresh` `{refreshToken}` / `POST /auth/logout` | Logout revokes every token of the user |
| `GET /me` / `GET /meta` | Profile + company permissions + simple mode / the company's setup and fixed form settings |
| `GET /users` | Everyone, deactivated people included, with `canDeactivate` |
| `POST /users` `{id, name, email, companyRole}` | Invite; Owner adds Admins; `EMAIL_TAKEN` if in use |
| `POST /users/:id/deactivate` | Owner: anyone but themselves; Admin: Members only |
| `GET /projects` / `GET /projects/:id` | Visible projects with members, access and delay |
| `POST /projects` `{id, name, client, address}` | Owner/Admin; four standard channels; idempotent by id |
| `PATCH /projects/:id` `{stage?, name?, client?, address?, archived?}` / `DELETE /projects/:id` | Managers / Owner-Admin |
| `POST /projects/:id/members` / `PATCH|DELETE /projects/:id/members/:userId` | Managers; default channels; one manager minimum |
| `GET /projects/:id/updates` / `GET /projects/:id/files` | Last status cards / photos and files |
| `GET /projects/:id/channels` / `POST /projects/:id/channels` | Browse (with `joined`, `memberCount`) / create (managers) |
| `GET /channels` / `GET /channels/:id` | Channels the user can read, with unread count and last message |
| `PATCH /channels/:id` / `DELETE /channels/:id` / `POST /channels/:id/join|leave` | Managers / public channels for join |
| `GET /channels/:id/messages?before=&limit=` | Newest first; top-level messages and replies sent to the channel |
| `POST /channels/:id/messages` `{id, type, body, data, threadParentId}` | Existing `id` → existing message, no second event |
| `GET /channels/:id/pins` / `GET /messages/:id/thread` | Pinned messages / thread parent and replies |
| `PATCH /messages/:id` / `DELETE /messages/:id` / `PUT /messages/:id/reactions/:emoji {on}` | Time windows and permissions checked |
| `POST /channels/:id/read` `{upToMessageId}` | Marker only moves forward |
| `GET /dms/:userId` / `POST /dms {userId}` | Find / open a DM; a DM without messages is hidden from both people's lists |
| `GET /projects/:id/tasks` / `GET /tasks/:id` (+history) / `GET /tasks?ids=` / `GET /me/tasks` | Today / this week / recently done grouped by the server |
| `POST /projects/:id/tasks` / `PATCH /tasks/:id` / `POST /tasks/:id/shift?days=` / `POST /tasks/:id/confirm` | The server fills in consequences (percent ↔ status, waiting for confirmation, actual dates) |
| `POST /projects/:id/baseline/lock` / `.../rebaseline {reason}` | Managers |
| `GET /me/checkins` / `POST /checkins/:id/answer` / `POST /bot/checkins` | Check-ins; answering is idempotent |
| `GET /activity` / `POST /activity/read` | Items + unread count; read state on the server |
| `POST /uploads` (multipart `file`) → `{uploadId, url}` / `GET /files/:id` | Photos up to 10 MB |
| `WS /ws?token=` | Live events (§10.3) |
| `/internal/*` | Demo panel only (§13) |

### 10.3 Behaviour rules

- **Permission checks on every route** using §9.2. Hidden resources return **404**, role violations **403**.
- **Validation** with Pydantic; failures → **422** `VALIDATION_FAILED` with `details.fields` (friendly messages, e.g. "Give the project a name").
- **Error format** always:
  ```json
  { "error": { "code": "TASK_BASELINE_LOCKED", "message": "...", "details": {}, "request_id": "req_01J..." } }
  ```
- **Idempotency:** creates keyed by client UUID; updates are absolute values.
- **Events after a write**, only to users allowed to see the resource: `message.new|updated|deleted`, `task.created|updated`, `channel.updated|deleted|member_added|member_removed|read`, `project.updated|deleted`, `checkin.new`, `activity.new|read`, `user.updated`. The app treats every event as "this changed" and fetches the affected data again.
- **Notifications:** messages notify immediately; task changes are **batched** per recipient for 10 s into one Activity item.

### 10.4 Error codes

`OTP_INVALID, OTP_EXPIRED, OTP_TOO_MANY_ATTEMPTS, AUTH_EXPIRED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, TASK_BASELINE_LOCKED, MESSAGE_EDIT_WINDOW_PASSED, CHANNEL_READ_ONLY, CHANNEL_NAME_TAKEN, EMAIL_TAKEN, CHANNEL_PRIVATE, PROJECT_ARCHIVED, RATE_LIMITED, INTERNAL_ERROR, SERVICE_UNAVAILABLE` (plus the client-side `OFFLINE`, `TIMEOUT`, `UNKNOWN`) — each with English, Kannada and Hindi user messages.

### 10.5 Network conditions and error injection (Demo panel)

- **Server:** Online · Slow (2–4 s before answering) · Flaky (30% of changes time out after 8 s, some after the server already saved them).
- **Phone offline** (switch): every request fails at once as `offline` and live updates disconnect.
- **Inject on the next change:** 500 · 403 · 422 · timeout-after-save. Sign-in and read markers are skipped.
- **Force access-token expiry** (next request 401 → silent refresh) and **Deactivate me** (refresh fails → back to sign-in).

### 10.6 Scripted teammates (`backend/app/actors.py`)

While someone is signed in and the server is Online, teammates act every 20–40 s (pausable) through the same write paths as real users:
- Kavya posts a design update with 2 photos in `#design`.
- Suresh posts site photos and raises a task's % in `#site-work`.
- Rohan posts a cost note in `#qs` (only QS/Managers/Owner/Admin see it).
- Amit shifts 5 task dates at once (batched notification), alternating later/earlier.
- The Owner posts in `#announcements` now and then.

---

## 11. Seed data

**Company:** Paliath Interiors, Bengaluru. Client names and addresses are placeholders ("Bengaluru").

**Users** (all OTP `123456`):

| Name | Work email | Company role | Projects (role · job title) |
|---|---|---|---|
| Arjun Rao | arjun@paliath.in | Owner (CEO) | — (sees all); owns two tasks so the bot has something to ask |
| Meera Iyer | meera@paliath.in | Admin (Operations) | — (sees all); owns one task |
| Amit Kulkarni | amit@paliath.in | Member | Villa 99 (Manager · Project Manager), OITH (Manager · Project Manager) |
| Kavya Shetty | kavya@paliath.in | Member | Villa 99 (Member · Designer), RV University (Manager · Project Manager) |
| Rohan Desai | rohan@paliath.in | Member | Villa 99 (Member · QS), RV University (Member · QS) |
| Suresh Gowda | suresh@paliath.in | Member | Villa 99 (Manager · Supervisor), OITH (Member · Supervisor) |
| Ravi Kumar | ravi@paliath.in | Member | Villa 99 (Member · Worker) |

Also 4 extra workers (Manjunath, Imran, Lakshmi, Prakash) spread across projects, without demo login chips. The Siteline Bot is `bot@siteline.app` and cannot sign in.

**Projects:**
1. **Villa 99** (full interior). Stage **Execution**, baseline locked, **4 days behind**. ~32 tasks across all phases; Civil/Electrical/Plumbing done; False ceiling in progress (one task blocked "Material not arrived"); Carpentry starting; Painting/Finishing/Handover not started.
2. **RV University** (campus interiors). Stage **Design**, baseline not locked, on track. ~12 tasks in a "Design" phase (concept, 3D renders, material board, client approval).
3. **OITH** (commercial fit-out). Stage **Finishing**, **1 day ahead**. ~18 tasks, mostly done.

**Channels per project:** `general`, `design`, `site-work`, `qs` (private). Company: `announcements` (admins post), `general`. DMs between Amit↔Ravi, Amit↔Suresh, Arjun↔Amit. Bot DM for everyone.

**Messages:** 30–60 realistic messages per busy channel over the past 10 days, with day dividers. Examples: "Plywood delivered — 18mm BWP, 40 sheets", "Client wants the TV unit 6 inches wider, updated drawing attached", "False ceiling grid done in living room, gypsum boards tomorrow", "Rate for Italian marble came in at ₹420/sq ft, ₹35 above budget". Include image messages, a voice note, a PDF file, task cards, status cards from check-ins, an issue card, a daily report, a thread with 4 replies, reactions, one edited message, one deleted message, and unread messages in at least 3 channels for each demo user.

**Images:** do **not** fetch from the internet. Render "photo" placeholders as tiles with a material-like colour (plywood beige, concrete grey, tile white, paint sage) plus a small Feather `image` icon and a caption overlay ("Living room ceiling"). Real photos from the camera/gallery display normally.

**Check-ins:** Ravi has one unanswered evening check-in for "False ceiling – living room" on first login. Opening the bot adds check-ins for his other open tasks.

---

## 12. Client architecture

### 12.1 Folders

```
src/
  features/
    auth/ home/ chat/ tasks/ projects/ people/ bot/ activity/ profile/ unsent/ demo/
      screens/      one file per screen (rendered by a thin route in app/)
      components/   pieces of those screens
      hooks.ts      reads: TanStack Query calls to one endpoint each
      api.ts        writes: call the API, then refresh what changed
    shared/         pieces several features use, imports no feature: session.ts (useMe, useCan,
                    useProjectAccess), data.ts (users, projects, project members, channels, unread,
                    refresh), display.ts (names, role labels, ordering, isBotUser), messages.ts
                    (sendMessage), photos.ts
  lib/
    api/        client.ts (typed AppError, auth refresh), transport.ts (fetch + WebSocket; the only place that knows the server address)
    queries.ts  cache keys and the live-event → refresh map
    mutations.ts attempt()/submit()/fieldErrors() for online-only writes
    outbox.ts   send queue for site actions; persist.ts saved screens and sign-in
    realtime/   socket.ts (live events → refresh)
    format.ts   display helpers only (dates, "is done")
    i18n/       index.ts, en.base.json, en.json (generated), kn.json, hi.json
    session.ts  sign in, sign out
  contract/     errorCodes.ts, schemas.ts (zod, for instant form feedback; the server checks again)
  components/   T, basics/ (identity, controls, layout, states), Sheet, form, chrome (Header, Screen, ErrorBoundary,
                Toast, OfflineBanner), PhotoGrid, CompanyTile
  stores/       session.ts, ui.ts (theme, language and other device settings are saved), demo.ts
  theme/        colors.ts, typography.ts, spacing.ts, useTheme.ts
```

Files in `app/` are routes only (§4). Features depend on each other one way only — shared ← tasks ← bot / projects ← chat, with home, people, activity, profile and demo on top — checked by `src/features/__tests__/boundaries.test.ts`. **Golden rule:** screens never call the API directly; they use feature hooks and feature `api.ts` functions.

### 12.2 Where data lives

- **Server:** everything (§10). The phone has no database and no rules.
- **TanStack Query:** a cache of API replies. The last successful replies are saved to the phone (AsyncStorage, per user, up to 7 days) and shown at app start before fresh data arrives (`src/lib/persist.ts`).
- **Send queue:** waiting site actions, saved per user (AsyncStorage) (`src/lib/outbox.ts`).
- **Sign-in:** tokens and profile in SecureStore, so the app opens signed in.
- **Zustand:** session, UI state, demo log.
- Sign-out deletes the sign-in and saved screens; a deliberate log out also deletes the queue (after the warning). Demo reset deletes everything.

### 12.3 API client

- One `api<T>(method, path, body?, form?)` function. Adds auth header and `X-Request-Id`.
- Converts every failure into `AppError { kind, code, details, requestId }` with kinds: `offline | timeout | auth | forbidden | not_found | validation | conflict | rate_limited | server`. A failed connection marks the app as offline (banner); any reply marks it online.
- 401 → single refresh attempt (shared promise) → retry once → else sign out.
- Server address: `EXPO_PUBLIC_API_URL`, else the machine running Expo on port 8000.

### 12.4 Writes and the send queue

**Through the send queue** (`src/lib/outbox.ts`) — the things workers do on site: new messages (with photos), check-in answers, task progress and status ("Started", "Update %", "Problem", done).
1. **Saved first:** the item is stored on the phone, then sent in the background; it survives closing the app.
2. **Safe to repeat:** each item carries an id made on the phone (the message id, the check-in id), so a retry never creates a duplicate.
3. **Order:** oldest first. A network problem pauses the whole queue, so nothing overtakes an earlier item.
4. **Photos first:** a message's photos upload before it; each photo uploads once, even if the message is retried.
5. **Merge:** waiting updates to the same task merge into one request.
6. **Retries:** offline, timeout, server error or rate limit → retry after 2 s, 5 s, 10 s, then every 20 s; also when the live connection comes back, when the app returns to the foreground, and from "Try sending now". A refusal (no permission, invalid, not found, conflict) → **Not sent**, with the reason, Retry and Discard; the queue moves on. An expired session keeps the item for the next sign-in.
7. **No guessing:** the phone never works out results. A queued message shows as the user wrote it with "Sending…"; a queued check-in answer shows as answered with a clock; a task with a queued update shows "Your update will show once it reaches the server". Real values arrive from the server.

**Online only** (fail at once with the reason): editing, deleting, reacting and pinning messages; creating tasks; project, channel and member settings; baseline; invites and deactivation. Forms wait for the server's reply and show its field errors.

### 12.5 Reads and refresh

Every screen reads through a query. Live events, the WebSocket reconnecting, the app returning to the foreground and pull-to-refresh all mark data stale so the screens on show fetch it again.

### 12.6 Realtime

`socket.ts` opens `WS /ws?token=` through `transport.ts`, reconnects with backoff, and pings every 25 s. Each event goes through `keysFor(event)` (`lib/queries.ts`) to the queries it affects.

### 12.7 Errors in the UI

Friendly translated messages by code; field errors under inputs; an offline banner ("You're offline. Messages and task updates will send when you're back." + "3 waiting") when the server can't be reached; "Couldn't load" states that never pretend a list is empty; an `ErrorBoundary` around each tab and stack screen with "Something went wrong · Go back". Never show codes or stack traces to the user (the Demo panel may show them).

---

## 13. Demo panel (`demo.tsx`)

Opened from a small floating **"Demo"** pill (bottom-left, above the tab bar, draggable, hideable; "Show the Demo button" on the You tab brings it back; hidden on the sign-in screens). It controls the server through `/internal/*` (`src/features/demo/api.ts`). Sections:

1. **Who am I:** switch to any demo user (signs in again; nothing from the previous person is kept). Shows their company role and per-project role/job title.
2. **Network:** server Online / Slow / Flaky; **Phone offline** switch; server address; live-updates and API status.
3. **Inject:** next change → 500 / 403 / 422 / timeout-after-save; force token expiry; deactivate me.
4. **Bot:** send morning summary now; send evening check-in now; trigger escalation now.
5. **Teammates:** pause/resume scripted activity; "Amit shifts 5 tasks now"; "Rohan posts in #qs now".
6. **Refresh:** fetch everything on screen again.
7. **Log:** last 30 API calls (method, path, status, ms, request id) and last 30 events received.
8. **Reset demo:** server data back to the seed, sign in again.

---

## 14. Demo script (acceptance criteria)

Each scenario must work end to end:

1. **First login as Ravi (Worker):** OTP screen, lands on Home with unread badges; Tasks tab shows "My tasks" with big buttons; the DMs tab shows the Siteline Bot with an unanswered check-in.
2. **Answer the check-in:** tap 75% on the scale. The card collapses to one line and the next task opens; `#site-work` shows a status card; switch to Amit and see the task at 75% with history "via check-in".
3. **No connection:** turn on Phone offline, send a message and tap "Started" on a task → "Sending…" and the offline banner with "2 waiting"; force-close and reopen the app → still signed in, screens shown, items still waiting; turn it off → both send once, in order.
4. **Photos:** send a photo in `#site-work` → it uploads to the server and appears for everyone in the channel.
5. **Slow server:** set Slow, change a task → it saves after 2–4 s; the log shows one PATCH.
6. **Timeout after save:** inject timeout-after-save, send a message → the app shows an error, the message is saved once on the server (no duplicate on retry).
7. **Refused change:** as Suresh, inject 403 then edit a task date → the change is not saved and the reason is shown.
8. **Permissions:** as Ravi, no "Edit dates", "Add member", "Lock baseline" or `#qs` channel; as Rohan, `#qs` visible; as Arjun, all projects, but other people's DMs are not listed on the DMs tab.
9. **Live updates:** while viewing Villa 99 tasks as Suresh, trigger "Amit shifts 5 tasks now" → rows update live; Activity shows one batched item.
10. **Baseline:** as Kavya (Manager of RV University), open the three-dot menu and lock the baseline; move a task's finish later → variance chip and red mini-bar; Re-baseline asks for a reason and logs it.
11. **Forms:** Report issue (Urgent) with a photo → issue card + Managers mentioned; Daily report card renders.
12. **Members:** as Amit, add Lakshmi as Member · Worker → default channels pre-ticked; she appears in `#site-work` member list; remove Ravi → as Ravi, the project disappears after the event/sync.
13. **Session:** force token expiry → next action works silently; deactivate me → back to sign-in.
14. **Logout** with waiting items warns first; it revokes the session on the server and the next person starts clean.
15. **Language:** switch to ಕನ್ನಡ as Ravi → check-in card, My tasks and error messages appear in Kannada.
16. **Dark mode** looks intentional on every screen.
17. **Project settings:** as Amit, add a private channel with three people → it appears for them only; make `#design` private; rename a channel; delete a channel.
18. **Browse and join:** as Kavya, Browse channels on Villa 99 → join `#site-work`; leave it again from the channel's details.
19. **Archive:** as Arjun, archive OITH → it moves to "Archived" on Home, its channels are read-only; unarchive brings it back. Delete a project by typing its name.
20. **Bot queue:** as Ravi, open the bot → progress bar "3 tasks need an update"; answer each in one tap; add a note to one; the bar ends at "All caught up".
21. **Task filters:** Pending + an owner + "Next 7 days" → "Showing N of M"; Clear restores the list.
22. **DMs:** start a new message from the DMs tab; back out without typing → no empty conversation is left behind.

---

## 15. Build order (milestones)

1. Project setup, theme tokens, fonts, components library, navigation skeleton, Demo pill.
2. Backend core: store, seed, routes, error format, permissions, auth, tests.
3. API client, queries, Home screen with sections and unread counts.
4. Channel screen, renderer registry, composer, threads, DMs, reactions, long-press menu.
5. API errors, network modes and injection.
6. WebSocket events, scripted teammates, Activity with batching.
7. Projects, tasks list, task detail, quick add, baseline, confirm flow.
8. Bot check-ins and morning summary; in-chat forms.
9. Members management, role-aware UI everywhere.
10. i18n (Kannada/Hindi for worker flow), dark mode pass, motion, empty states, final polish against §14.

After each milestone: run the app, check the relevant §14 scenarios, and commit.

Before calling any change done: `npm run typecheck`, `npm run lint`, `npm test`, and `backend/.venv/bin/pytest` in `backend/`.

---

## 16. Quality bar

- 60 fps scrolling in channels with 500 messages on a mid-range Android phone.
- Every screen has designed **empty**, **loading** (skeleton rows, not spinners) and **error** states.
- No layout jumps when images load (reserve aspect ratio).
- Text never truncates awkwardly; long project names ellipsize in one line in rows, wrap in headers.
- All copy is plain and short. Buttons use verbs ("Send", "Add task", "Lock baseline").
- Accessibility: labels on icon buttons, sufficient contrast in both themes, dynamic type up to 130% without breaking layouts.

---

## 17. Explicitly out of scope

A production backend (database, deployment, monitoring), offline use, real email codes, real push, cloud file storage, real voice recording and file picking, reactivating people, crash reporting, search beyond local filtering, video calls, message search across history, task dependencies, Gantt chart, AI assistant, client (homeowner) guest role, iOS-specific polish, app store builds.

---

## Appendix A — `CLAUDE.md` for this repo

See `CLAUDE.md` in the repo root (kept in sync with §10 and §12).

## Appendix B — Copy tone examples

| Situation | Text |
|---|---|
| Offline banner | You're offline. Messages and task updates will send when you're back. |
| Failed message | Couldn't send. Tap for options. |
| Task edit rejected | Couldn't save your change to False ceiling: only managers can change dates. |
| Empty channel | No messages yet. Share an update or a photo from site. |
| Empty My tasks | Nothing due today. Enjoy the calm. |
| Read-only channel | Only admins can post here. |
| Removed from project | You no longer have access to Villa 99. |
| Archived project | This project is archived. It is read-only. |
| Bot progress | 3 tasks need an update · 0 of 3 done |
| Bot finished | All caught up. Thanks! |
| Logout warning | 3 changes haven't been sent yet. Log out anyway? |
