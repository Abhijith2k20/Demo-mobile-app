# Siteline — Demo App Implementation Spec

> **For Claude Code.** Build a clickable, realistic **demo** of an internal project-communication app for an interior design company. It runs entirely on the phone with a **mock backend** (no real server). The goal is to *see and feel* the real product so the owner can make decisions. Read this whole file before starting. When something is unclear, choose the simplest option that keeps the architecture described here, and note it in `DECISIONS.md`.

---

## 0. What this demo must prove

1. **The experience:** Slack-style workspace navigation, channels per project, chat, tasks with schedules, a button-based bot, in-chat forms, and a CEO dashboard, all simple enough for site workers.
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
- **Original visual identity.** The layout and density are *inspired by* Slack's mobile app (see §3), but do **not** use Slack's logo, name, colours, icon set, illustrations or copy.

---

## 2. Tech stack

| Concern | Library |
|---|---|
| Framework | Expo (latest stable SDK), React Native, TypeScript |
| Navigation | `expo-router` (file-based) |
| Local database | `expo-sqlite` (open with `enableChangeListener: true`) + `drizzle-orm` (expo-sqlite driver, `useLiveQuery`) |
| Server cache (non-offline screens) | `@tanstack/react-query` |
| App-only state | `zustand` |
| Lists | `@shopify/flash-list` |
| Bottom sheets | `@gorhom/bottom-sheet` + `react-native-reanimated` + `react-native-gesture-handler` |
| Forms | `react-hook-form` + `zod` |
| Images | `expo-image`, `expo-image-picker` |
| IDs | `uuidv7` (pure JS) |
| Dates | `date-fns` |
| i18n | `i18next` + `react-i18next` (English full; Kannada and Hindi for the worker flow only) |
| Icons | `@expo/vector-icons` (Feather set only, for consistency) |
| Fonts | `@expo-google-fonts/inter` (Inter 400/500/600/700) |
| Haptics | `expo-haptics` (light tap on send, success on task done) |

**Database setup:** create tables with raw `CREATE TABLE IF NOT EXISTS` statements on first launch. No migration tooling for the demo.

---

## 3. Design language

### 3.1 Direction

**Information architecture and density inspired by Slack mobile:** a workspace home made of collapsible sections, compact channel rows with bold-when-unread names, left-aligned message rows (avatar, name, time, text — not bubbles), threads, and interactive "block"-style cards in the message stream.

**Visual identity is our own:** warm, calm and material, fitting an interior design firm. Think *architect's drawing set meets well-run site office*. Ink-dark headers, warm off-white surfaces, one confident terracotta accent, generous touch targets for site workers.

Name: **Siteline**. Company in seed data: **Aanya Interiors** (fictional).

### 3.2 Colour tokens

Define in `src/theme/colors.ts` with light and dark values. Never hard-code colours in components.

| Token | Light | Dark | Use |
|---|---|---|---|
| `header` | `#16262B` | `#0F1A1D` | Workspace header, tab bar active tint background areas |
| `onHeader` | `#F4EFE8` | `#E9E4DC` | Text/icons on header |
| `bg` | `#FBF8F3` | `#121514` | App background |
| `surface` | `#FFFFFF` | `#1A1E1D` | Cards, sheets, rows |
| `surfaceAlt` | `#F2EDE5` | `#232827` | Section headers, inputs, pressed rows |
| `border` | `#E6DFD4` | `#2E3432` | Hairlines (0.5–1 px) |
| `text` | `#1B1F1E` | `#ECE8E1` | Primary text |
| `textMuted` | `#6B6F6C` | `#9EA29E` | Secondary text, timestamps |
| `textFaint` | `#9A9C97` | `#6E726F` | Placeholders, disabled |
| `accent` | `#C4622D` | `#E07A43` | Primary buttons, unread badges, links, active states |
| `accentSoft` | `#F7E6DB` | `#3A2418` | Accent backgrounds (selected chip, mention highlight) |
| `success` | `#2F7A4F` | `#5DB884` | Done, sent ticks, on-track |
| `successSoft` | `#E3F1E8` | `#173324` | |
| `warning` | `#B7791F` | `#E3A94A` | At risk, waiting, retrying |
| `warningSoft` | `#FBF0DC` | `#3A2C12` | Offline banner |
| `danger` | `#B3392F` | `#E5675C` | Failed, delayed, destructive |
| `dangerSoft` | `#FBE7E5` | `#3C1A17` | |
| `info` | `#2D6A8A` | `#6BAED0` | Stage pills, sending state |
| `infoSoft` | `#E2EFF6` | `#14293A` | |

**Avatar colours:** 8 muted earthy tones (clay, sage, slate, ochre, plum, teal, sand, rust), picked deterministically from the user ID. Initials in white, 600 weight.

**Project stage colours** (pill background / text): Design → `infoSoft/info`, Approval → `accentSoft/accent`, Procurement → `warningSoft/warning`, Execution → `#E8E4F6/#5B4BA8` (dark: `#2A2446/#A99BEA`), Finishing → `successSoft/success`, Handover → `surfaceAlt/textMuted`.

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

- **Workspace header** in deep ink with the company name, a small square company logo tile (initials "AI" on terracotta), and a search field below it, like a drawing title block.
- **Stage banner** at the top of every project channel: a thin bar showing the 6 stages as segments, current stage filled, with "Execution · 4 days behind baseline" text. Tapping opens the project.
- **Message grouping:** consecutive messages from the same sender within 5 minutes collapse (no repeated avatar/name). Day dividers ("Today", "Yesterday", "Mon 6 Oct") as centred `label` text with hairlines.
- **"New" divider** in accent colour above the first unread message.
- **Outbox status** on own messages, after the timestamp: clock (pending/sending), single check (sent), red alert-circle (failed, tappable).
- **Photo grids** like a site log: 1 photo full-width (4:3), 2 side by side, 3–4 in a 2 × 2 grid, more shows "+N".
- **Bot cards** look like structured blocks: a left accent rule, title, context line, and full-width buttons stacked vertically for workers.

---

## 4. Navigation structure

```
app/
  _layout.tsx                 Providers, theme, fonts, DB init, auth gate, Demo pill
  (auth)/
    login.tsx                 Phone number
    otp.tsx                   6-digit code
  (app)/
    _layout.tsx               Bottom tabs
    (home)/index.tsx          Home (workspace)
    (tasks)/index.tsx         Tasks (role-aware)
    (activity)/index.tsx      Activity
    (you)/index.tsx           You / profile & settings
  channel/[id].tsx            Channel conversation
  thread/[messageId].tsx      Thread
  dm/[userId].tsx             Direct message
  project/[id]/index.tsx      Project overview (tabs: Overview, Tasks, Members, Files)
  project/[id]/members.tsx    Manage members (Managers only)
  task/[id].tsx               Task detail
  dashboard.tsx               Company dashboard (Owner/Admin)
  unsent.tsx                  Unsent / failed items
  demo.tsx                    Demo panel (modal)
```

**Bottom tabs:** Home, Tasks, Activity, You. For Owner/Admin the Tasks tab is replaced by **Dashboard**. Tab bar on `surface`, active tint `accent`, labels `meta` size. Unread badge on Home and Activity.

---

## 5. Screens

### 5.1 Login and OTP (mock)

- **Login:** company tile, "Sign in to Aanya Interiors", phone field with `+91` prefix, primary button "Send code". Below, a muted section **"Demo: sign in as"** with 7 tappable user chips (avatar, name, role/title) that fill the number.
- **OTP:** 6 separate digit boxes, auto-advance, "Resend code in 0:28" countdown. Code for every demo user is **`123456`**. Wrong code → inline red error from the mock error code `OTP_INVALID`; 5 wrong attempts → `OTP_TOO_MANY_ATTEMPTS`.
- On success: tokens stored in memory/zustand (secure storage not needed in demo), run first **sync**, go to Home.

### 5.2 Home (workspace)

Top to bottom:
1. **Workspace header** (ink): logo tile, "Aanya Interiors", chevron; search field ("Jump to…") filtering channels/people/projects locally.
2. **Offline banner** (only when offline): `warningSoft`, "You're offline. Changes will send automatically." + count "3 waiting".
3. **Sections** (collapsible, state remembered in zustand):
   - **PROJECTS** — one collapsible row per project the user can see: project name (`bodyStrong` if any unread), stage pill, delay indicator (red dot + "4d" if behind baseline). Expanded: its channels indented, each `# design`, `# site-work`, `🔒 qs`, `# general`, unread count badge on the right, bold name when unread.
   - **COMPANY** — `# announcements` (read-only for Members: composer replaced by "Only admins can post here"), `# general`.
   - **DIRECT MESSAGES** — avatar + name + presence dot (green if "online" in mock), unread badge. The **Siteline Bot** DM pinned first.
4. **Floating action button** (accent, bottom-right): "New message" for everyone; Owner/Admin also see "New project".

Pull-to-refresh runs sync. Rows are 44 px tall.

### 5.3 Channel conversation

- **Header:** back, `# site-work` (`heading`), subtitle "Sharma Residence · 6 members", right icons: search (non-functional stub ok), info (opens channel details sheet with members and pinned items).
- **Stage banner** (project channels only), see §3.7.
- **Message list** (FlashList, inverted, reads from local DB via `useLiveQuery`, latest 50, loads older on scroll):
  - Message row: 36 px rounded-square avatar, name (`bodyStrong`) + job title chip (tiny `label`) + time (`meta`), body text, attachments, reactions row, "3 replies · Last reply 2h ago" thread link.
  - Long-press menu (bottom sheet): React (6 quick emoji), Reply in thread, Copy text, **Create task from message**, Edit (own, within 15 min), Delete (own within 1 h; Managers any), Pin (Managers).
  - Renderer registry by `type` (see §7.4). Unknown type → "Update the app to see this message."
- **Composer:** rounded input on `surfaceAlt`, left **"+"** button, right **send** (accent when text present, else mic for voice note).
  - **"+" sheet** grid: Camera, Gallery, Voice note, File, **New task**, **Report issue**, **Daily report**. Each with a 48 px icon tile.
  - **Worker mode:** a large camera button sits left of the input (48 px, accent outline).
- **Read-only channels** show a muted bar instead of the composer.

### 5.4 Thread

Parent message at top (full), divider "12 replies", replies list, composer. Option "Also send to #site-work" checkbox.

### 5.5 Direct message

Same as channel without stage banner. The **Siteline Bot** DM is where check-ins appear (see §8).

### 5.6 Project overview (`project/[id]`)

Segmented control: **Overview · Tasks · Members · Files**.

- **Overview:** project name (`title`), client and address (`meta`), **stage stepper** (6 steps horizontal, current highlighted; Managers can tap "Move to next stage" → confirmation sheet), key dates card (start, planned finish, baseline finish, "4 days behind"), progress ring (% of tasks done), "Channels" list, "Recent updates" (last 5 status cards).
- **Tasks:** same component as §5.7 scoped to the project.
- **Members:** list with avatar, name, **role badge** (Manager / Member), job title, channels. Managers see "Add member" and can edit role/job title/channels (§5.11).
- **Files:** grid of all photos and files from the project's channels, newest first.

### 5.7 Tasks tab (role-aware)

**Managers (and Owner/Admin inside a project):** a schedule list.
- Project switcher at top (dropdown sheet).
- Filter chips: All · Mine · Delayed · Blocked · Done.
- Grouped by **phase** (Civil, Electrical, Plumbing, False ceiling, Carpentry, Painting, Finishing, Handover) with sticky phase headers showing "3/7 done".
- **Task row:** status dot, name, owner avatar (20 px), date range `meta` ("18–21 Oct"), a thin **mini timeline bar** showing planned span vs baseline (baseline as a faint outline, planned as solid; red if planned finish > baseline finish), % on the right.
- **Quick-add bar** pinned at bottom: "Add a task…" input; enter creates a task with smart defaults (starts the day after the previous task in that phase ends, 3 days long, same phase, owner unassigned).
- Swipe right: mark done (Managers: confirmed; Members: "done — awaiting confirmation"). Swipe left: shift dates (sheet with −1/+1/+3/+7 days).
- **Lock baseline** button in the project header when the baseline isn't locked; once locked, shows a lock icon; "Re-baseline" asks for a reason.

**Members (e.g. Worker):** **"My tasks"** home.
- Greeting "Good morning, Ravi" and date.
- **Today** card list: big rows (task name `heading`, project, due), each with three large buttons: **Started**, **Update %**, **Problem**.
- "This week" and "Done recently" sections.
- No baseline or variance shown.

### 5.8 Task detail (`task/[id]`)

Presented as a full-height bottom sheet.
- Name (editable by Managers), project › phase breadcrumb, status selector (Not started / In progress / Blocked / Done), % slider snapping to 0/25/50/75/90/100 (save on release).
- Owner picker (project members only).
- **Dates block:** Planned start/finish (editable by Managers), Baseline start/finish (read-only, lock icon), Actual start/finish (auto), and a **variance chip** ("+4 days").
- Linked channel and "Discuss in #site-work" button.
- **History timeline:** every change with who, what, when ("Amit changed finish 24 Oct → 26 Oct · 2h ago"; "Ravi set progress to 75% · via check-in").
- Members who can't edit see fields as read-only text, not disabled inputs.

### 5.9 Activity

Mentions, thread replies, task assignments, task changes and check-in results, newest first. **Batched** task-change items ("Amit changed dates on 20 tasks in Sharma Residence · 3 are yours"), expandable. Unread items have an accent left rule.

### 5.10 Dashboard (Owner/Admin)

- Stat tiles row: Active projects · Delayed · Tasks due this week · Blocked.
- **Projects by stage:** horizontal segmented bar with counts.
- **Delayed projects** list (name, stage pill, days behind, PM avatar) → tap opens project.
- **Today on sites:** recent check-in results and photos (cards with thumbnail strip).
- Uses TanStack Query against `GET /dashboard` (not local DB) with cached data shown first and a "Couldn't refresh" chip when the mock fails.

### 5.11 Manage members (Managers)

- List of project members; "Add member" opens a sheet: search company directory → choose **Role** (Manager / Member, segmented) → choose **Job title** (Designer, QS, Supervisor, Worker) → shows **default channels** that will be joined (checkboxes pre-ticked per §9.3, editable) → Add.
- Edit and remove members. Removing shows: "Ravi will lose access to this project. His messages stay."

### 5.12 You

Avatar, name, phone, company role, list of projects with project role + job title. Settings: Language (English / ಕನ್ನಡ / हिंदी), Theme (System/Light/Dark), Notifications (stub toggles), **Unsent items** (count), **Send now**, **Log out** (if unsent items exist: "3 changes haven't been sent yet. Log out anyway?").

### 5.13 Unsent (`unsent.tsx`)

Lists outbox items in **Failed** state (and, in a second section, items waiting more than 24 h). Each row: what it was ("Message in #site-work: 'Starting POP…'"), error reason in plain words, actions **Retry**, **Edit** (messages/tasks), **Discard**.

---

## 6. Forms inside chat (bottom sheets)

All built with react-hook-form + zod; schemas mirror the backend. Pre-fill project, channel and today's date. Submitting creates outbox items and posts a **card message** to the channel.

| Form | Fields | Result card |
|---|---|---|
| **New task** | Name*, Phase (picker), Owner (project members), Planned start/finish (date pickers, finish ≥ start), Description | Task card |
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

interface User { id: ID; name: string; phone: string; companyRole: CompanyRole; avatarColor: string; isActive: boolean; }
interface Project { id: ID; companyId: ID; name: string; client: string; address: string; stage: Stage;
  startDate: string; plannedFinish: string; baselineFinish: string | null; baselineLocked: boolean; updatedAt: string; }
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
  kind: "started" | "progress" | "problem" | "done"; percent?: number; reason?: string; note?: string }; }
```

### 7.2 Local SQLite tables

`users, projects, project_members, channels, channel_members, messages, tasks, task_history, checkins, outbox, kv` (kv stores `lastSyncTime`, current user, settings). Indexes: `messages(channel_id, created_at)`, `tasks(project_id, phase)`, `outbox(status, next_attempt_at)`, `outbox(lane, created_at)`.

### 7.3 Outbox table

```ts
interface OutboxItem { id: ID; kind: OutboxKind; lane: string; entityId: ID; payload: string; dependsOn: ID | null;
  status: "pending" | "sending" | "failed"; attempts: number; nextAttemptAt: number;
  lastErrorCode: string | null; createdAt: number; }
type OutboxKind = "send_message" | "edit_message" | "delete_message" | "set_reaction" | "mark_read"
  | "create_task" | "update_task" | "checkin_answer" | "upload_file" | "project_stage" | "lock_baseline"
  | "member_add" | "member_update" | "member_remove";
```

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

- Lives in a DM channel of kind `bot` with every user.
- **Check-in card** (`checkin`): title "How is **False ceiling – living room**?", context "Sharma Residence · due Sat 11 Oct", then stacked full-width buttons: ✅ Done · 🔨 Working on it · ⛔ Problem · Not started.
  - **Working on it** → card expands in place to chips **25% · 50% · 75% · 90%**.
  - **Problem** → chips: Material not arrived · Waiting for design · Labour short · Other, plus "Add photo" and "Voice note" buttons.
  - **Done** → "Add a photo of the finished work?" (Add photo / Skip).
  - After answering, the card collapses to a summary ("You: Working on it · 75% · 6:04 PM") and buttons disappear.
- Each answer → outbox `checkin_answer` (carries the check-in ID, safe to repeat) → mock server updates the task, writes history, posts a **status card** in the project's `#site-work` ("Ravi · False ceiling – living room → 75% 📷").
- **Morning summary** message: "Good morning Ravi. Your tasks today: …" with task links.
- **Reminder** if unanswered after (demo) 60 s; **escalation** status card to the Supervisor/Manager after another 60 s: "Ravi hasn't updated False ceiling."
- Demo panel buttons trigger "Send morning summary" and "Send evening check-in" for the current user immediately.

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

---

## 10. Mock backend

### 10.1 Shape

An **in-process mock server** in `src/mock/` that the app talks to through the same API client it will later use for the real server. **Do not import mock internals anywhere else.** Swapping to the real backend later must only change the transport in `src/lib/api/transport.ts`.

```
src/mock/
  server.ts        route table: (method, path, body, auth) → response | MockError
  db.ts            in-memory store (plain objects/Maps), seeded from seed.ts
  seed.ts          all demo data (§11)
  routes/*.ts      one file per resource, same paths as the real API
  events.ts        event bus that emulates the WebSocket (subscribe per user)
  actors.ts        scripted teammates (§10.6)
  network.ts       network conditions + error injection (§10.5)
```

The in-memory store resets when the app is reloaded or via **Demo panel → Reset demo** (which also wipes the local SQLite DB).

### 10.2 Endpoints (same as the planned FastAPI API)

| Method & path | Notes |
|---|---|
| `POST /auth/otp/request` `{phone}` | Always "sent" for known numbers; generic response otherwise |
| `POST /auth/otp/verify` `{phone, code}` | `123456` → `{accessToken, refreshToken, user}` |
| `POST /auth/refresh` | Demo panel can force access-token expiry to show silent refresh |
| `GET /sync?since=` | Changes since time (minus 2-min overlap applied by the client), `{serverTime, users, projects, projectMembers, channels, channelMembers, messages, tasks, taskHistory, checkins, removed:{channels,tasks,messages}, hasMore}`; first sync returns latest 50 messages per channel |
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
| `POST /uploads` → `{uploadId, uploadUrl}`; `PUT <uploadUrl>` | Simulated: stores the local file URI, takes 1–4 s ("slow" for big files) |
| `GET/POST/PATCH/DELETE /projects/:id/members[/:userId]` | Managers; applies default channels |
| `GET /dashboard` | Owner/Admin only |
| `GET /users` | Company directory |

### 10.3 Behaviour rules (must match the real server design)

- **Permission checks on every route** using §9.2. Hidden resources return **404**, role violations **403**.
- **Validation** with zod; failures → **422** `VALIDATION_FAILED` with `details.fields`.
- **Error format** always:
  ```json
  { "error": { "code": "TASK_BASELINE_LOCKED", "message": "...", "details": {}, "request_id": "req_01J..." } }
  ```
- **Idempotency:** creates keyed by client UUID; updates are absolute values.
- **Events after "commit":** after a successful write, publish to `events.ts`: `message.new`, `message.updated`, `message.deleted`, `task.updated` (full task), `task.created`, `channel.updated`, `channel.member_added`, `channel.member_removed`, `project.updated`, `checkin.new`. Only to users allowed to see the resource. Never publish for a duplicate create.
- **Notifications:** messages notify immediately; task changes are **batched** per recipient for 10 s (demo-shortened from 2 min) into one Activity item.
- **Latency:** every request 250–900 ms random; uploads 1–4 s.

### 10.4 Error codes to implement

`OTP_INVALID, OTP_EXPIRED, OTP_TOO_MANY_ATTEMPTS, AUTH_EXPIRED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, TASK_BASELINE_LOCKED, MESSAGE_EDIT_WINDOW_PASSED, CHANNEL_READ_ONLY, RATE_LIMITED, INTERNAL_ERROR, SERVICE_UNAVAILABLE` — each with English, Kannada and Hindi user messages in i18n files (Kannada/Hindi may be marked "demo translation").

### 10.5 Network conditions and error injection (Demo panel)

- **Network:** Online · Slow (2–4 s latency) · Flaky (30% of requests time out after 8 s, some after the server already applied them) · Offline (every request fails immediately as `offline`; event bus disconnected).
- **Inject on next request:** 500 · 403 · 422 · timeout-after-save (server applies, client never gets the reply — demonstrates idempotency).
- **Force access-token expiry** (next request returns 401 → client refreshes silently).
- **Deactivate current user** (next request 401 and refresh fails → app wipes data and returns to login).

### 10.6 Scripted teammates (`actors.ts`)

When the network is Online, teammates act on a timer (every 20–40 s, random, pausable from the Demo panel) so the app feels alive and live events can be seen:
- Kavya (Designer) posts a design update with 2 photos in `#design`.
- Suresh (Supervisor) posts site photos and updates a task's % in `#site-work`.
- Rohan (QS) posts a cost note in `#qs` (only visible to QS/Managers/Owner/Admin — demonstrates channel privacy).
- Amit (PM) shifts 5 task dates at once (demonstrates batched notifications and live task updates).
- Owner posts in `#announcements` occasionally.

---

## 11. Seed data

**Company:** Aanya Interiors, Bengaluru.

**Users** (all OTP `123456`):

| Name | Phone | Company role | Projects (role · job title) |
|---|---|---|---|
| Arjun Rao | 98450 00001 | Owner (CEO) | — (sees all) |
| Meera Iyer | 98450 00002 | Admin (Operations) | — (sees all) |
| Amit Kulkarni | 98450 00003 | Member | Sharma Residence (Manager · Project Manager), Café Brew (Manager · Project Manager) |
| Kavya Shetty | 98450 00004 | Member | Sharma Residence (Member · Designer), Mehta Villa (Manager · Project Manager) |
| Rohan Desai | 98450 00005 | Member | Sharma Residence (Member · QS), Mehta Villa (Member · QS) |
| Suresh Gowda | 98450 00006 | Member | Sharma Residence (Manager · Supervisor), Café Brew (Member · Supervisor) |
| Ravi Kumar | 98450 00007 | Member | Sharma Residence (Member · Worker) |

Also 4 extra workers (Manjunath, Imran, Lakshmi, Prakash) spread across projects, without demo login chips.

**Projects:**
1. **Sharma Residence – Whitefield** (3BHK full interior). Stage **Execution**, baseline locked, **4 days behind**. ~32 tasks across all phases; Civil/Electrical/Plumbing done; False ceiling in progress (one task blocked "Material not arrived"); Carpentry starting; Painting/Finishing/Handover not started.
2. **Mehta Villa – Koramangala** (villa). Stage **Design**, baseline not locked, on track. ~12 tasks (concept, 3D renders, material board, client approval).
3. **Café Brew Fit-out – Indiranagar** (commercial). Stage **Finishing**, **1 day ahead**. ~18 tasks, mostly done.

**Channels per project:** `general`, `design`, `site-work`, `qs` (private). Company: `announcements` (admins post), `general`. DMs between Amit↔Ravi, Amit↔Suresh, Arjun↔Amit. Bot DM for everyone.

**Messages:** 30–60 realistic messages per busy channel over the past 10 days, with day dividers. Examples: "Plywood delivered — 18mm BWP, 40 sheets", "Client wants the TV unit 6 inches wider, updated drawing attached", "False ceiling grid done in living room, gypsum boards tomorrow", "Rate for Italian marble came in at ₹420/sq ft, ₹35 above budget". Include image messages, a voice note, a PDF file, task cards, status cards from check-ins, an issue card, a daily report, a thread with 4 replies, reactions, one edited message, one deleted message, and unread messages in at least 3 channels for each demo user.

**Images:** do **not** fetch from the internet. Render "photo" placeholders as tiles with a material-like colour (plywood beige, concrete grey, tile white, paint sage) plus a small Feather `image` icon and a caption overlay ("Living room ceiling"). Real photos from the camera/gallery display normally.

**Check-ins:** Ravi has one unanswered evening check-in for "False ceiling – living room" on first login.

---

## 12. Client architecture

### 12.1 Folders

```
src/
  features/
    auth/ home/ chat/ threads/ tasks/ projects/ members/ bot/ activity/ dashboard/ profile/ unsent/
      (each: components/, hooks/, api.ts)
  lib/
    api/        client.ts (typed AppError, auth refresh), transport.ts (mock now, fetch later)
    db/         schema.ts, client.ts, init.ts
    sync/       catchup.ts, applyIncoming.ts
    outbox/     enqueue.ts, runner.ts, lanes.ts, merge.ts, classify.ts, handlers/*.ts
    realtime/   socket.ts (subscribes to mock events now; WebSocket later)
    i18n/       index.ts, en.json, kn.json, hi.json
  shared/       permissions.ts, errorCodes.ts, schemas.ts (zod, shared with mock server)
  components/   Avatar, Badge, Pill, Button, Sheet, Row, SectionHeader, Banner, EmptyState, ErrorBoundary, …
  stores/       session.ts, ui.ts, demo.ts
  theme/        colors.ts, typography.ts, spacing.ts, useTheme.ts
  mock/         (see §10)
```

**Golden rule:** screens never call the API or the database directly; they use feature hooks (`useChannelMessages`, `useSendMessage`, `useMyTasks`, `useUpdateTask`, …).

### 12.2 Where data lives

- **Local SQLite** (live queries): users, projects, members, channels, messages, tasks, history, check-ins, outbox.
- **TanStack Query:** dashboard, company directory.
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

Runner triggers: new item, app foreground, network back (demo panel), event bus reconnect, 10 s timer. One run at a time; one request at a time (uploads run in their own concurrent slot).

### 12.5 Sync

`catchUp()` on login, app foreground, reconnect, pull-to-refresh. Uses server time minus 2 min, pages with `hasMore`, writes in one transaction, applies `removed`, then reapplies pending outbox changes (rule 6). Newer `updatedAt` wins when saving.

### 12.6 Realtime

`socket.ts` subscribes the current user to `mock/events.ts`. On event: write to local DB (newer wins) or invalidate a query. On "reconnect" (network back): run `catchUp()`. Disconnect when offline.

### 12.7 Errors in the UI

Friendly translated messages by code; field errors under inputs; offline banner; clock/tick/red icons; "Couldn't refresh" chips; an `ErrorBoundary` around each tab and stack screen with "Something went wrong · Go back". Never show codes or stack traces to the user (the Demo panel may show them).

---

## 13. Demo panel (`demo.tsx`)

Opened from a small floating **"Demo"** pill (bottom-left, above the tab bar, draggable, hideable). Sections:

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

1. **First login as Ravi (Worker):** OTP screen, lands on Home with unread badges; Tasks tab shows "My tasks" with big buttons; Bot DM shows an unanswered check-in.
2. **Answer the check-in:** Working on it → 75%. Card collapses to summary; `#site-work` shows a status card; switch to Amit and see the task at 75% with history "via check-in".
3. **Offline send:** set Offline, send text + photo in `#site-work` → clock icons + offline banner with count; go Online → upload then message deliver in order; no duplicates.
4. **Lanes:** Slow network, send a photo in `#site-work` then a text in Café Brew `#general` (as Suresh) → the text arrives first.
5. **Merging:** as Amit, Offline, edit one task 5 times → outbox inspector shows one item with final values; Online → one PATCH in the log.
6. **Timeout after save:** inject timeout-after-save, send a message → it retries and shows once (server returned existing).
7. **Permanent failure:** as Suresh, inject 403 then edit a task date → change reverts with explanation; item appears in Unsent with Retry/Discard.
8. **Permissions:** as Ravi, no "Edit dates", "Add member", "Lock baseline" or `#qs` channel; as Rohan, `#qs` visible; as Arjun, all projects + Dashboard tab, but other people's DMs are not listed.
9. **Live updates:** while viewing Sharma Residence tasks as Suresh, trigger "Amit shifts 5 tasks now" → rows update live; Activity shows one batched item.
10. **Baseline:** as Kavya (Manager of Mehta Villa), lock the baseline; move a task's finish later → variance chip and red mini-bar; Re-baseline asks for a reason and logs it.
11. **Forms:** Report issue (Urgent) with a photo → issue card + Managers mentioned; Daily report card renders.
12. **Members:** as Amit, add Lakshmi as Member · Worker → default channels pre-ticked; she appears in `#site-work` member list; remove Ravi → as Ravi, the project disappears after the event/sync.
13. **Session:** force token expiry → next action works silently; deactivate me → wiped and back to login.
14. **Logout with unsent items** shows the warning.
15. **Language:** switch to ಕನ್ನಡ as Ravi → check-in card, My tasks and error messages appear in Kannada.
16. **Dark mode** looks intentional on every screen.

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

Real backend, real OTP/SMS, real push, real file storage, search beyond local filtering, video calls, message search across history, task dependencies, Gantt chart, AI assistant, client (homeowner) guest role, iOS-specific polish, app store builds.

---

## Appendix A — `CLAUDE.md` for this repo

```md
# Siteline demo — rules
- Read SITELINE_DEMO_SPEC.md before any change. It is the source of truth.
- Must run in Expo Go. Do not add libraries that need a dev build.
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
| Removed from project | You no longer have access to Sharma Residence. |
| Logout warning | 3 changes haven't been sent yet. Log out anyway? |
