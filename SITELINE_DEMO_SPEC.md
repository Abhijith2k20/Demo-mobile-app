# Siteline — Demo App Implementation Spec

> **Version 1.2 — updated to match the code.** This file describes the app as it is built today. Where the first version said something different, the text here has been changed; the reasons are in `DECISIONS.md`. A planned change that is **not built yet** (parent/sub-tasks and areas, replacing phases) is parked in `docs/CHANGE_01_PARENT_SUBTASKS_AREAS.md`.

> **For Claude Code.** Build a clickable, realistic **demo** of an internal project-communication app for an interior design company. It runs entirely on the phone with a **mock backend** (no real server). The goal is to *see and feel* the real product so the owner can make decisions. Read this whole file before starting. When something is unclear, choose the simplest option that keeps the architecture described here, and note it in `DECISIONS.md`.

---

## 0. What this demo must prove

1. **The experience:** Slack-style workspace navigation, channels per project, a DMs tab, chat, tasks with schedules, a button-based bot, in-chat forms, project settings, and a CEO dashboard, all simple enough for site workers.
2. **The architecture:** local SQLite as the source for screens, an **outbox** following the seven rules, catch-up **sync**, live **events**, a typed **error** system, and **role-based permissions**. The mock backend behaves like the real FastAPI server will (same endpoints, same error format, same events) so the app code can later point at the real server with minimal change.
3. **Decision support:** a **Demo panel** lets the viewer switch user and role, go offline, inject errors, trigger the bot, and watch the outbox, so every design decision can be seen in action.

**Not in scope:** a real server, real login, real push notifications, real file storage, iOS-specific polish, production security.

---

## 1. Hard constraints

- **Must run in Expo Go** (no custom native modules, no dev build required). Every library below is Expo Go compatible.
- **TypeScript strict mode.** No `any` except at the mock-server boundary.
- **Android first.** Test on a mid/low-end Android phone. Smooth scrolling is a requirement.
- **Light and dark mode**, following the system setting.
- **No network required.** All data, images and avatars work offline. (The camera/gallery picker is the only device feature used.)
- **No borrowed branding.** The layout, density and neutral palette follow mainstream work-chat apps such as Slack (see §3), but do **not** use Slack's logo, name, brand purple, icon set, illustrations or copy.

---

## 2. Tech stack

| Concern | Library |
|---|---|
| Framework | Expo (latest stable SDK), React Native, TypeScript |
| Navigation | `expo-router` (file-based) |
| Local database | `expo-sqlite` (open with `enableChangeListener: true`) + `drizzle-orm` (expo-sqlite driver, `useLiveQuery`) |
| Server cache (non-offline screens) | `@tanstack/react-query` |
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
| Tests | `jest` + `jest-expo` (`npm test`): outbox lane order, task rules, permissions, task filters |
| Lint | `eslint` 9 + `eslint-config-expo` (`npm run lint`) |

Built on **Expo SDK 57** (React Native 0.86, React 19.2, Reanimated 4.5). `.npmrc` sets `legacy-peer-deps=true`.

**Database setup:** create tables with raw `CREATE TABLE IF NOT EXISTS` statements on first launch. No migration tooling for the demo.

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
| `textFaint` | `#9A9B9E` | `#6F7174` | Placeholders, disabled |
| `accent` | `#1667B0` | `#4A9FE0` | Primary buttons, unread badges, links, active states |
| `accentSoft` | `#E8F1F9` | `#1B2E40` | Accent backgrounds (selected chip, mention highlight) |
| `onAccent` | `#FFFFFF` | `#FFFFFF` | Text/icons on accent |
| `success` | `#2E7D5B` | `#5FB58C` | Done, sent ticks, on-track |
| `successSoft` | `#E6F2EC` | `#1B2F26` | |
| `warning` | `#9A6B15` | `#D6A64F` | At risk, waiting, retrying |
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
| `display` | 28 / 34 | 700 | Dashboard numbers |
| `title` | 20 / 26 | 700 | Screen titles, workspace name |
| `heading` | 17 / 22 | 600 | Channel name in header, card titles |
| `body` | 16 / 23 | 400 | Messages, form inputs |
| `bodyStrong` | 16 / 23 | 600 | Sender names, unread channel names |
| `meta` | 13 / 18 | 400 | Timestamps, subtitles |
| `label` | 12 / 16 | 600, uppercase, letter-spacing 0.6 | Section headers ("PROJECTS"), field labels |
| `metaStrong` | 13 / 18 | 600 | Small emphasised text, chips |
| `button` | 16 / 22 | 600 | Button labels |

Worker mode (job title Worker) bumps `body` to 17 and buttons to 18.

### 3.4 Spacing, shape, elevation

- 4-pt grid: `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32`. Screen side padding 16.
- Radii: inputs/buttons 10, cards 14, sheets 20 (top corners), pills 999, avatars 8 (rounded square, not circles — part of our identity).
- Elevation: almost flat. Cards use a 1 px `border`; only bottom sheets and the floating Demo pill get a soft shadow.
- Minimum touch target 44 × 44 (48 × 48 for worker check-in buttons).

### 3.5 Motion

- 150–220 ms ease-out for presses, sheet opens, row expansion. No bouncy springs.
- New incoming message: fade + 8 px slide up.
- Outbox status icon changes cross-fade.
- Respect "reduce motion".

### 3.6 Iconography

Feather icons only, 20 px in rows, 22 px in headers/tab bar, 1.75 stroke look. Channel rows use `#` text glyph (not an icon) for public channels and Feather `lock` for private.

### 3.7 Signature details (what makes it feel crafted, not generic)

- **Workspace header** in dark blue-grey with the company name, a small square company logo tile (initials "PI" on the accent colour), and a search field below it.
- **Stage banner** at the top of every project channel: a thin bar showing the 6 stages as segments, current stage filled, with "Execution · 4 days behind baseline" text. Tapping opens the project.
- **Message grouping:** consecutive messages from the same sender within 5 minutes collapse (no repeated avatar/name). Day dividers ("Today", "Yesterday", "Mon 6 Oct") as centred `label` text with hairlines.
- **"New" divider** in accent colour above the first unread message.
- **Outbox status** on own messages, after the timestamp: clock (pending/sending), single check (sent), red alert-circle (failed, tappable).
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
  thread/[messageId].tsx      → features/threads/screens/ThreadScreen
  dm/[userId].tsx             → features/chat/screens/DmScreen (`/dm/bot` is the Siteline Bot)
  project/[id]/index.tsx      → features/projects/screens/ProjectScreen (Overview, Tasks, Members, Files)
  project/[id]/settings.tsx   → features/projects/screens/ProjectSettingsScreen
  project/[id]/members.tsx    → features/members/screens/MembersScreen
  task/[id].tsx               → features/tasks/screens/TaskDetailScreen
  dashboard.tsx               → features/dashboard/screens/DashboardScreen
  unsent.tsx                  → features/unsent/screens/UnsentScreen
  demo.tsx                    → features/demo/screens/DemoPanelScreen (modal)
```

Tab files are `index`, `dms`, `tasks`, `activity`, `you` (not `(home)/index` etc.): several `index` routes in sibling groups would all map to `/`.

**Bottom tabs:** Home, DMs, Tasks, Activity, You. For Owner/Admin the Tasks tab is titled **Dashboard** and shows the dashboard. Tab bar on `surface`, active tint `accent`. Unread badges: Home counts channel messages only, DMs counts direct messages, Activity counts unseen items.

---

## 5. Screens

### 5.1 Login and OTP (mock)

Both screens share one layout (`AuthShell`): the dark header with the logo tile, "Paliath Interiors" and "Siteline workspace", over a rounded card that holds the form. The Demo pill is hidden on these two screens.

- **Login:** title "Sign in", one large phone field with `+91` prefix, primary button **Continue** (enabled at ten digits). At the bottom, a link **"Use a demo account"** opens a sheet listing the 7 demo users (avatar, name, role/title); picking one goes straight to the code screen. A help line: "Can't sign in? Ask your company admin to add your number."
- **OTP:** six boxes in two groups of three, fed by one hidden input (so paste and SMS autofill work), the number shown with a **Change** link, "Resend in 0:28" countdown then **Resend code**. Signs in automatically on the sixth digit. Code for every demo user is **`123456`**. Wrong code → inline red error from `OTP_INVALID`; 5 wrong attempts → `OTP_TOO_MANY_ATTEMPTS`.
- On success: tokens stored in memory/zustand (secure storage not needed in demo), run first **sync**, go to Home.

### 5.2 Home (workspace)

Top to bottom:
1. **Workspace header:** logo tile, "Paliath Interiors", chevron; search field ("Jump to…") filtering channels, people and projects locally. Picking a person opens their DM.
2. **Offline banner** (only when offline): `warningSoft`, "You're offline. Changes will send automatically." + count "3 waiting".
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
  - **Worker mode:** a large camera button sits left of the input (48 px, accent outline).
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

### 5.7 Tasks tab (role-aware)

**Anyone who manages at least one project (and Owner/Admin inside a project):** a schedule list.
- Project switcher at top (dropdown sheet; managed projects first, archived last).
- **Toolbar:** two quick chips, **Mine** and **Pending** (everything not finished), a **Filters** button with a count of active filters, and a **three-dot menu** on the right. When any filter is on, a line shows "Showing 3 of 18 tasks" with **Clear**.
- **Filters sheet:** Status (multi-select), Owner (Me, Unassigned, or one person), Due (Any time, Overdue, Next 7 days, Next 30 days), Schedule (Behind baseline; only when a baseline exists), Phase (multi-select). Filters combine with AND. The button reads "Show N tasks". Filters reset when the screen is left. Logic is in `features/tasks/filters.ts` (tested).
- **Three-dot menu** (only for people who may change the baseline): shows the baseline state and **Lock baseline** (with confirmation) or **Re-baseline** (asks for a reason, logged in `#general`).
- Grouped by **phase** (Civil, Electrical, Plumbing, False ceiling, Carpentry, Painting, Finishing, Handover, plus any custom phase) with sticky phase headers showing "3/7 done".
- **Task row:** status dot, name, owner avatar (20 px), date range `meta` ("18–21 Oct"), a thin **mini timeline bar** showing planned span vs baseline (baseline as a faint outline, planned as solid; red if planned finish > baseline finish), % on the right.
- **Quick-add bar** pinned at bottom: a phase chip (tap to change) and "Add a task…"; enter creates a task with smart defaults (starts the day after the previous task in that phase ends, 3 days long, owner unassigned).
- Swipe right: mark done (Managers: confirmed; Members: "done — awaiting confirmation"). Swipe left: shift dates (sheet with −1/+1/+3/+7 days).

**Members (e.g. Worker):** **"My tasks"** home.
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

### 5.10 Dashboard (Owner/Admin)

- **Headline:** "Needs attention — 1 project is behind schedule and 1 task is blocked", or "Everything is on track".
- **Four numbers:** Active projects · Behind schedule · Tasks due in 7 days · Blocked tasks. Numbers stay in text colour; a small icon marks a problem.
- **Projects:** every active project, most delayed first: name, stage pill, schedule health in words with an icon ("4d behind", "1d ahead", "On track", "No baseline"), progress bar and %, "12 of 32 tasks done · 1 blocked", PM avatar → tap opens the project.
- **Blocked now:** blocked tasks with project and owner → tap opens the task. Hidden when empty.
- **Pipeline:** six cells, one per stage, each with its project count.
- **From site:** check-in results, daily reports and photos from the last 36 hours, with small thumbnails.
- Archived projects are left out.
- Uses TanStack Query against `GET /dashboard` (not local DB) with cached data shown first and a "Couldn't refresh" chip when the mock fails.

### 5.11 Manage members (Managers)

- List of project members; "Add member" opens a sheet: search company directory → choose **Role** (Manager / Member, segmented) → choose **Job title** (Designer, QS, Supervisor, Worker) → shows **default channels** that will be joined (checkboxes pre-ticked per §9.3, editable) → Add.
- Edit and remove members. Removing shows: "Ravi will lose access to this project. Their messages stay."
- Choosing **Manager** ticks every channel: managers are always in every channel of their project.

### 5.12 You

Avatar, name, phone, company role, list of projects with project role + job title. Settings: Language (English / ಕನ್ನಡ / हिंदी), Theme (System/Light/Dark), Notifications (stub toggles), **Unsent items** (count), **Send now**, **Show the Demo button** (when hidden), **Log out** (if unsent items exist: "3 changes haven't been sent yet. Log out anyway?").

### 5.13 Unsent (`unsent.tsx`)

Lists outbox items in **Failed** state (and, in a second section, items waiting more than 24 h). Each row: what it was ("Message in #site-work: 'Starting POP…'"), error reason in plain words, actions **Retry**, **Edit** (messages/tasks), **Discard**.

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

All built with react-hook-form + zod; schemas mirror the backend. Pre-fill project, channel and today's date. Submitting creates outbox items and posts a **card message** to the channel.

| Form | Fields | Result card |
|---|---|---|
| **New task** | Name*, Phase (picker), Owner (project members), Planned start/finish (calendar sheet, finish ≥ start), Description | Task card |
| **Report issue** | What's wrong* (preset chips: Material not arrived, Waiting for design, Labour short, Damage, Other + text), Photos (0–4), Related task (optional), Urgency (Normal/Urgent) | Issue card (danger accent) and, if Urgent, a mention of the project Managers |
| **Daily report** | Work done today*, Workers on site (stepper), Photos (0–6), Problems (optional), Tomorrow's plan | Daily report card |

Validation errors show under the field, in red `meta` text.

---

## 7. Data model (client)

### 7.1 Types (`src/types/models.ts`)

```ts
type ID = string; // UUIDv7

type CompanyRole = "owner" | "admin" | "member";
type ProjectRole = "manager" | "member";
type JobTitle = "Project Manager" | "Designer" | "QS" | "Supervisor" | "Worker";
type Stage = "design" | "approval" | "procurement" | "execution" | "finishing" | "handover";

interface User { id: ID; name: string; phone: string; companyRole: CompanyRole; avatarColor: string; isActive: boolean;
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
  status: "pending" | "sending" | "sent" | "failed"; createdAt: string; updatedAt: string; deletedAt: string | null; }

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

### 7.2 Local SQLite tables

`users, projects, project_members, channels, channel_members, messages, tasks, task_history, checkins, activity, outbox, kv` (kv stores `lastSyncTime`). Indexes: `messages(channel_id, created_at)`, `messages(channel_id, id)` (unread counts), `messages(thread_parent_id)`, `tasks(project_id, phase)`, `task_history(task_id)`, `outbox(status, next_attempt_at)`, `outbox(lane, created_at)`.

A row created on the phone and not yet confirmed by the server carries `updatedAt = 1970-01-01T00:00:00.000Z` (`LOCAL_ONLY`). Optimistic edits never change `updatedAt`.

**Demo only:** the local database is dropped on every app launch, because the mock server's memory is lost on reload. Remove `dropAll()` in `src/lib/db/init.ts` for a real backend.

### 7.3 Outbox table

```ts
interface OutboxItem { id: ID; kind: OutboxKind; lane: string; entityId: ID; payload: string; dependsOn: ID | null;
  status: "pending" | "sending" | "failed"; attempts: number; nextAttemptAt: number;
  lastErrorCode: string | null; createdAt: number; }
type OutboxKind = "send_message" | "edit_message" | "delete_message" | "set_reaction" | "mark_read"
  | "create_task" | "update_task" | "checkin_answer" | "upload_file" | "project_stage" | "lock_baseline"
  | "member_add" | "member_update" | "member_remove"
  | "create_dm" | "create_project" | "update_project" | "archive_project" | "delete_project"
  | "create_channel" | "update_channel" | "delete_channel" | "join_channel";
```

Message `data` flags used by the app: `edited`, `pinned`, `mentions` (user ids), `alsoToChannel` (thread reply also shown in the channel), `attachments`.

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
- Each answer → outbox `checkin_answer` (carries the check-in ID, safe to repeat) → mock server updates the task, writes history "via check-in", posts a **status card** in the project's `#site-work` ("Ravi · False ceiling – living room → 75%", with the note) and an Activity item for the managers. "Not started" changes nothing on the task.
- **Morning summary:** a small table, "Good morning, Ravi · 2 today", one row per task with due date and progress; rows open the task.
- **Reminder** if unanswered after (demo) 60 s: a single quiet line, not a second card. **Escalation** status card to the Managers after another 60 s: "Ravi hasn't updated False ceiling." The batch asked on open carries no reminder timer; the Demo panel's single evening check-in does.
- Demo panel buttons trigger "Send morning summary", "Send evening check-in" and "Trigger escalation" for the current user immediately.

---

## 9. Roles and permissions

### 9.1 Model

- Company roles: **Owner**, **Admin**, **Member**. Owner/Admin see every project and channel (but **never other people's DMs**).
- Project roles: **Manager**, **Member**. Job title is a label that sets default channels only.

### 9.2 Permission map (shared by mock server and app)

`src/shared/permissions.ts` — used by the mock server to **enforce** and by the app to **hide** controls.

```ts
export const PROJECT_PERMISSIONS = {
  manager: ["project.edit", "project.stage", "project.members", "channel.manage", "task.create",
            "task.edit_any", "task.update_for_others", "task.confirm", "task.baseline",
            "message.delete_any", "message.pin"],
  member:  ["task.create", "task.update_own"],
} as const;

export function can(user: User, action: string, ctx: { projectRole?: ProjectRole | null }): boolean {
  if (user.companyRole === "owner" || user.companyRole === "admin") return true;
  return !!ctx.projectRole && (PROJECT_PERMISSIONS[ctx.projectRole] as readonly string[]).includes(action);
}
```

Company-level actions (`company.users`, `project.create`) are Owner/Admin only. Posting in `postingPolicy: "admins"` channels is Owner/Admin only.

### 9.3 Default channels by job title

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
- **Archived project:** read-only for everyone. No new messages, task changes, channel changes or check-ins (`409 PROJECT_ARCHIVED`); the app hides every editing control. It moves to "Archived" on Home and is left out of the dashboard, My tasks and bot check-ins. Nothing is deleted; a Manager can unarchive.
- **Deleting a project** is Owner/Admin only and removes its channels, messages, tasks and memberships for everyone.
- Deleting a channel removes its messages for everyone (no channel archive in the demo).

Not built yet: adding people to the **company** (`company.users`). The demo only has the seeded people.

---

## 10. Mock backend

### 10.1 Shape

An **in-process mock server** in `src/mock/` that the app talks to through the same API client it will later use for the real server. **Do not import mock internals anywhere else.** Swapping to the real backend later must only change the transport in `src/lib/api/transport.ts`.

```
src/mock/
  server.ts        route table: (method, path, body, auth) → response | error; latency + injection
  db.ts            in-memory store and "who can see what" helpers, seeded from seed.ts
  seed.ts          all demo data (§11)
  routes/          auth.ts, sync.ts, messages.ts, tasks.ts, projects.ts, channels.ts,
                   misc.ts (check-ins, uploads, dashboard, directory)
  events.ts        event bus that emulates the WebSocket (subscribe per user)
  actors.ts        scripted teammates (§10.6)
  network.ts       network conditions + error injection (§10.5)
  bot.ts           check-ins, reminders, escalation, morning summary
  notify.ts        Activity items and 10 s batching of task changes
  http.ts          routing, validation and error helpers
  access.ts        shared access checks
```

The in-memory store resets when the app is reloaded or via **Demo panel → Reset demo** (which also wipes the local SQLite DB).

### 10.2 Endpoints (same as the planned FastAPI API)

| Method & path | Notes |
|---|---|
| `POST /auth/otp/request` `{phone}` | Always "sent" for known numbers; generic response otherwise |
| `POST /auth/otp/verify` `{phone, code}` | `123456` → `{accessToken, refreshToken, user}` |
| `POST /auth/refresh` | Demo panel can force access-token expiry to show silent refresh |
| `GET /sync?since=` | Changes since time (minus 2-min overlap applied by the client), `{serverTime, users, projects, projectMembers, channels, channelMembers, messages, tasks, taskHistory, checkins, activities, removed:{projects,channels,tasks,messages}, hasMore, cursor}`; memberships are always sent in full; first sync returns latest 50 messages per channel |
| `GET /channels/:id/messages?before=&limit=` | Older history |
| `POST /channels/:id/messages` `{id, type, body, data, threadParentId}` | Existing `id` → return existing, 200 |
| `PATCH /messages/:id` / `DELETE /messages/:id` | Time-window and permission checks |
| `PUT /messages/:id/reactions/:emoji` `{on: boolean}` | Absolute, not toggle |
| `POST /channels/:id/read` `{upToMessageId}` | |
| `POST /projects/:id/tasks` `{id, ...}` | Idempotent by id |
| `PATCH /tasks/:id` (changed fields only) | Writes task_history per field |
| `POST /tasks/:id/confirm` | Managers |
| `POST /projects/:id/baseline/lock` / `.../rebaseline {reason}` | Managers |
| `PATCH /projects/:id` `{stage}` | Managers; posts a system message in `#general` |
| `POST /checkins/:id/answer` | Idempotent by check-in id |
| `POST /uploads` `{clientId}` → `{uploadId, uploadUrl}`; `PUT <uploadUrl>` `{uri}` | Simulated: stores the local file URI, takes 1–4 s ("slow" for big files) |
| `GET/POST/PATCH/DELETE /projects/:id/members[/:userId]` | Managers; applies default channels |
| `GET /dashboard` | Owner/Admin only |
| `GET /users` | Company directory |
| `POST /dms` `{id, userId}` | Open a DM; idempotent by id or by the pair of people |
| `POST /projects` `{id, name, client, address}` | Owner/Admin; creates the four standard channels |
| `PATCH /projects/:id` also accepts `{name, client, address}` and `{archived}` | Managers |
| `DELETE /projects/:id` | Owner/Admin |
| `GET /projects/:id/channels` | Channels the user may know about, with `joined` and `memberCount` |
| `POST /projects/:id/channels` `{id, name, isPrivate, memberIds}` | Managers; idempotent by id |
| `PATCH /channels/:id` `{name?, isPrivate?, memberIds?}` / `DELETE /channels/:id` | Managers |
| `POST /channels/:id/join` / `.../leave` | Public channels only for join |
| `POST /bot/checkins` | Ask about every open task the user owns (called when the bot DM opens) |

### 10.3 Behaviour rules (must match the real server design)

- **Permission checks on every route** using §9.2. Hidden resources return **404**, role violations **403**.
- **Validation** with zod; failures → **422** `VALIDATION_FAILED` with `details.fields`.
- **Error format** always:
  ```json
  { "error": { "code": "TASK_BASELINE_LOCKED", "message": "...", "details": {}, "request_id": "req_01J..." } }
  ```
- **Idempotency:** creates keyed by client UUID; updates are absolute values.
- **Events after "commit":** after a successful write, publish to `events.ts`: `message.new`, `message.updated`, `message.deleted`, `task.updated` (full task + new history rows), `task.created`, `channel.updated`, `channel.member_added`, `channel.member_removed`, `project.updated`, `checkin.new`, `activity.new`. Membership and project events make the app run a catch-up sync. Only to users allowed to see the resource. Never publish for a duplicate create.
- **Notifications:** messages notify immediately; task changes are **batched** per recipient for 10 s (demo-shortened from 2 min) into one Activity item.
- **Latency:** every request 250–900 ms random; uploads 1–4 s.

### 10.4 Error codes to implement

`OTP_INVALID, OTP_EXPIRED, OTP_TOO_MANY_ATTEMPTS, AUTH_EXPIRED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, TASK_BASELINE_LOCKED, MESSAGE_EDIT_WINDOW_PASSED, CHANNEL_READ_ONLY, CHANNEL_NAME_TAKEN, CHANNEL_PRIVATE, PROJECT_ARCHIVED, RATE_LIMITED, INTERNAL_ERROR, SERVICE_UNAVAILABLE` (plus the client-side `OFFLINE`, `TIMEOUT`, `DEPENDENCY_FAILED`, `UNKNOWN`) — each with English, Kannada and Hindi user messages in i18n files (Kannada/Hindi may be marked "demo translation").

### 10.5 Network conditions and error injection (Demo panel)

- **Network:** Online · Slow (2–4 s latency) · Flaky (30% of requests time out after 8 s, some after the server already applied them) · Offline (every request fails immediately as `offline`; event bus disconnected).
- **Inject on next request:** 500 · 403 · 422 · timeout-after-save (server applies, client never gets the reply — demonstrates idempotency). The injection applies to the next **change** the app sends; sync, auth and read-marker requests are skipped.
- **Force access-token expiry** (next request returns 401 → client refreshes silently).
- **Deactivate current user** (next request 401 and refresh fails → app wipes data and returns to login).

### 10.6 Scripted teammates (`actors.ts`)

When the network is Online, teammates act on a timer (every 20–40 s, random, pausable from the Demo panel) so the app feels alive and live events can be seen:
- Kavya (Designer) posts a design update with 2 photos in `#design`.
- Suresh (Supervisor) posts site photos and updates a task's % in `#site-work`.
- Rohan (QS) posts a cost note in `#qs` (only visible to QS/Managers/Owner/Admin — demonstrates channel privacy).
- Amit (PM) shifts 5 task dates at once (demonstrates batched notifications and live task updates). The shift alternates one day later / one day earlier so a long demo does not drift.
- Owner posts in `#announcements` occasionally.

---

## 11. Seed data

**Company:** Paliath Interiors, Bengaluru. Client names and addresses are placeholders ("Bengaluru").

**Users** (all OTP `123456`):

| Name | Phone | Company role | Projects (role · job title) |
|---|---|---|---|
| Arjun Rao | 98450 00001 | Owner (CEO) | — (sees all); owns two tasks so the bot has something to ask |
| Meera Iyer | 98450 00002 | Admin (Operations) | — (sees all); owns one task |
| Amit Kulkarni | 98450 00003 | Member | Villa 99 (Manager · Project Manager), OITH (Manager · Project Manager) |
| Kavya Shetty | 98450 00004 | Member | Villa 99 (Member · Designer), RV University (Manager · Project Manager) |
| Rohan Desai | 98450 00005 | Member | Villa 99 (Member · QS), RV University (Member · QS) |
| Suresh Gowda | 98450 00006 | Member | Villa 99 (Manager · Supervisor), OITH (Member · Supervisor) |
| Ravi Kumar | 98450 00007 | Member | Villa 99 (Member · Worker) |

Also 4 extra workers (Manjunath, Imran, Lakshmi, Prakash) spread across projects, without demo login chips.

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
    auth/ home/ chat/ threads/ tasks/ projects/ members/ bot/ activity/ dashboard/ profile/ unsent/ demo/
      screens/      one file per screen (rendered by a thin route in app/)
      components/   pieces of those screens
      hooks.ts      live queries (read)
      api.ts        writes: local change + outbox item in one transaction
    shared.ts       hooks used by several features (useMe, useProjectAccess, useOutbox, …)
  lib/
    api/        client.ts (typed AppError, auth refresh), transport.ts (mock now, fetch later)
    db/         schema.ts, client.ts, init.ts
    sync/       catchup.ts, applyIncoming.ts
    outbox/     enqueue.ts, runner.ts, lanes.ts, merge.ts, classify.ts, types.ts, handlers/*.ts
    realtime/   socket.ts (subscribes to mock events now; WebSocket later)
    i18n/       index.ts, en.base.json, en.json (generated), kn.json, hi.json
    session.ts  sign in, sign out, wipe
  shared/       permissions.ts, errorCodes.ts, schemas.ts (zod), taskRules.ts (shared with mock server)
  components/   T, basics (Avatar, Badge, Pill, Button, Chip, Row, …), Sheet, form (Field, DateField, …),
                chrome (Header, Screen, ErrorBoundary, Toast), PhotoGrid, CompanyTile
  stores/       session.ts, ui.ts, demo.ts
  theme/        colors.ts, typography.ts, spacing.ts, useTheme.ts
  mock/         (see §10)
scripts/
  extract-i18n.mjs   builds en.json from the English defaults written in code
```

Files in `app/` are routes only (§4). Not every feature has every file; small ones keep components beside `hooks.ts`.

**Golden rule:** screens never call the API or the database directly; they use feature hooks (`useChannelMessages`, `useSendMessage`, `useMyTasks`, `useUpdateTask`, …).

### 12.2 Where data lives

- **Local SQLite** (live queries): users, projects, members, channels, messages, tasks, history, check-ins, activity, outbox.
- **TanStack Query:** dashboard, company directory, "Browse channels" (channels you are not in exist only on the server).
- **Zustand:** session, UI state (collapsed sections, open sheets, drafts), demo settings.

### 12.3 API client

- One `api<T>(method, path, body)` function. Adds auth header and `X-Request-Id`.
- Converts every failure into `AppError { kind, code, details, requestId }` with kinds: `offline | timeout | auth | forbidden | not_found | validation | conflict | rate_limited | server`.
- 401 → single refresh attempt (shared promise so only one refresh runs) → retry once → else log out and wipe local data.

### 12.4 Outbox (implement all seven rules)

1. **One transaction:** local change + outbox insert together.
2. **Lanes:** `channel:<id>`, `task:<id>`, `project:<id>`, `upload`, `meta`. Same lane → strict order; different lanes independent. `dependsOn` links a photo message to its upload; if the dependency fails permanently, dependents fail with reason `DEPENDENCY_FAILED`.
3. **Merge** unsent `update_task` items for the same task; editing/deleting an unsent message updates/removes it; never merge into a `sending` item.
4. **Safe to repeat:** client UUIDs for creates, absolute values for updates.
5. **On app start:** `sending` → `pending`.
6. **Re-apply pending changes** when sync or events bring a record that still has unsent changes.
7. **Retry policy:** temporary (`offline, timeout, server, rate_limited`) → backoff with jitter, **demo timings 2 s, 5 s, 10 s, then every 20 s**; `offline` stops the run. `auth` → refresh once. Permanent (`validation, forbidden, not_found, conflict`) → `failed` immediately, roll back or flag per kind (messages keep a red mark; task edits revert to server value with a toast "Couldn't save your change to *X*: <reason>").

**Additions to the rules:**
- A message's read marker only moves forward.
- A full re-sync requested while another sync runs is kept, not dropped.
- A full re-sync keeps channels, DMs and projects that were created on the phone and not sent yet.
- For changes that touch many rows (baseline lock, member and channel changes, project delete) a permanent failure triggers a full re-sync instead of a field-by-field rollback.
- Housekeeping items (`mark_read`, reactions) are dropped silently if the server refuses them for good.
- Replies that arrive after a logout or a user switch are discarded.
- Deleting a channel also removes messages still queued for it.

Runner triggers: new item, app foreground, network back (demo panel), event bus reconnect, 10 s timer. One run at a time; one request at a time (uploads run in their own concurrent slot).

### 12.5 Sync

`catchUp()` on login, app foreground, reconnect, pull-to-refresh. Uses server time minus 2 min, pages with `hasMore`, writes in one transaction, applies `removed`, then reapplies pending outbox changes (rule 6). Newer `updatedAt` wins when saving.

### 12.6 Realtime

`socket.ts` subscribes the current user through `transport.ts` (which wraps `mock/events.ts`). On event: write to local DB (newer wins) or invalidate a query. On "reconnect" (network back): run `catchUp()`. Disconnect when offline.

### 12.7 Errors in the UI

Friendly translated messages by code; field errors under inputs; offline banner; clock/tick/red icons; "Couldn't refresh" chips; an `ErrorBoundary` around each tab and stack screen with "Something went wrong · Go back". Never show codes or stack traces to the user (the Demo panel may show them).

---

## 13. Demo panel (`demo.tsx`)

Opened from a small floating **"Demo"** pill (bottom-left, above the tab bar, draggable, hideable; "Show the Demo button" on the You tab brings it back; hidden on the sign-in screens). Sections:

1. **Who am I:** switch to any demo user instantly (re-login + full re-sync). Shows their company role and per-project role/job title.
2. **Network:** Online / Slow / Flaky / Offline (segmented). Shows "Event bus: connected/disconnected".
3. **Inject:** next request → 500 / 403 / 422 / timeout-after-save; force token expiry; deactivate me.
4. **Bot:** send morning summary now; send evening check-in now; trigger escalation now.
5. **Teammates:** pause/resume scripted activity; "Amit shifts 5 tasks now"; "Rohan posts in #qs now".
6. **Outbox inspector:** live table of outbox items (lane, kind, status, attempts, next attempt in, last error) with "Run now" and "Clear failed".
7. **Sync:** last sync time, "Sync now", "Wipe local DB and re-sync".
8. **Log:** last 30 API calls (method, path, status, ms, request id) and last 30 events received.
9. **Reset demo.**

---

## 14. Demo script (acceptance criteria)

Each scenario must work end to end:

1. **First login as Ravi (Worker):** OTP screen, lands on Home with unread badges; Tasks tab shows "My tasks" with big buttons; the DMs tab shows the Siteline Bot with an unanswered check-in.
2. **Answer the check-in:** tap 75% on the scale. The card collapses to one line and the next task opens; `#site-work` shows a status card; switch to Amit and see the task at 75% with history "via check-in".
3. **Offline send:** set Offline, send text + photo in `#site-work` → clock icons + offline banner with count; go Online → upload then message deliver in order; no duplicates.
4. **Lanes:** Slow network, send a photo in `#site-work` then a text in OITH `#general` (as Suresh) → the text arrives first.
5. **Merging:** as Amit, Offline, edit one task 5 times → outbox inspector shows one item with final values; Online → one PATCH in the log.
6. **Timeout after save:** inject timeout-after-save, send a message → it retries and shows once (server returned existing).
7. **Permanent failure:** as Suresh, inject 403 then edit a task date → change reverts with explanation; item appears in Unsent with Retry/Discard.
8. **Permissions:** as Ravi, no "Edit dates", "Add member", "Lock baseline" or `#qs` channel; as Rohan, `#qs` visible; as Arjun, all projects + Dashboard tab, but other people's DMs are not listed on the DMs tab.
9. **Live updates:** while viewing Villa 99 tasks as Suresh, trigger "Amit shifts 5 tasks now" → rows update live; Activity shows one batched item.
10. **Baseline:** as Kavya (Manager of RV University), open the three-dot menu and lock the baseline; move a task's finish later → variance chip and red mini-bar; Re-baseline asks for a reason and logs it.
11. **Forms:** Report issue (Urgent) with a photo → issue card + Managers mentioned; Daily report card renders.
12. **Members:** as Amit, add Lakshmi as Member · Worker → default channels pre-ticked; she appears in `#site-work` member list; remove Ravi → as Ravi, the project disappears after the event/sync.
13. **Session:** force token expiry → next action works silently; deactivate me → wiped and back to login.
14. **Logout with unsent items** shows the warning.
15. **Language:** switch to ಕನ್ನಡ as Ravi → check-in card, My tasks and error messages appear in Kannada.
16. **Dark mode** looks intentional on every screen.
17. **Project settings:** as Amit, add a private channel with three people → it appears for them only; make `#design` private; rename a channel; delete a channel.
18. **Browse and join:** as Kavya, Browse channels on Villa 99 → join `#site-work`; leave it again from the channel's details.
19. **Archive:** as Arjun, archive OITH → it moves to "Archived" on Home, its channels are read-only, it leaves the dashboard; unarchive brings it back. Delete a project by typing its name.
20. **Bot queue:** as Ravi, open the bot → progress bar "3 tasks need an update"; answer each in one tap; add a note to one; the bar ends at "All caught up".
21. **Task filters:** Pending + an owner + "Next 7 days" → "Showing N of M"; Clear restores the list.
22. **DMs:** start a new message from the DMs tab; back out without typing → no empty conversation is left behind.

---

## 15. Build order (milestones)

1. Project setup, theme tokens, fonts, components library, navigation skeleton, Demo pill.
2. Mock server core: db, seed, route table, error format, latency, permissions, auth routes.
3. Local DB, sync, Home screen with sections and unread counts.
4. Channel screen, renderer registry, composer, threads, DMs, reactions, long-press menu.
5. Outbox (all seven rules), API client errors, network modes and injection, Unsent screen, outbox inspector.
6. Realtime event bus, scripted teammates, Activity with batching.
7. Projects, tasks list, task detail, quick add, baseline, confirm flow.
8. Bot check-ins and morning summary; in-chat forms.
9. Members management, role-aware UI everywhere, Dashboard.
10. i18n (Kannada/Hindi for worker flow), dark mode pass, motion, empty states, final polish against §14.

After each milestone: run the app, check the relevant §14 scenarios, and commit.

Before calling any change done: `npm run typecheck`, `npm run lint`, `npm test`.

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

Real backend, real OTP/SMS, real push, real file storage, real voice recording and file picking, adding people to the company, crash reporting, search beyond local filtering, video calls, message search across history, task dependencies, Gantt chart, AI assistant, client (homeowner) guest role, iOS-specific polish, app store builds.

---

## Appendix A — `CLAUDE.md` for this repo

```md
# Siteline demo — rules
- Read SITELINE_DEMO_SPEC.md before any change. It is the source of truth.
- Must run in Expo Go. Do not add libraries that need a dev build.
- Files in app/ are routes only: read URL params and render a screen from src/features/<area>/screens/.
- Screens never call the API or DB directly; use feature hooks.
- All writes go through the outbox (one transaction with the local change).
- Never import from src/mock outside src/lib/api/transport.ts and the Demo panel.
- Permissions come only from src/shared/permissions.ts (server enforces, app hides).
- Errors: services/routes return the standard error format; the app shows translated messages by code.
- Colours, spacing and type only from src/theme. No hard-coded colours.
- Record any deviation from the spec in DECISIONS.md.
```

## Appendix B — Copy tone examples

| Situation | Text |
|---|---|
| Offline banner | You're offline. Changes will send automatically. |
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
