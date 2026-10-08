# Change 01 — Parent/sub-tasks and areas (replaces phases)

> **Status: NOT STARTED — parked for later.** Nothing in this document has been implemented yet.
> See "Planning notes" at the end for what was found when the codebase was inspected and the
> decisions that are still open.

> **For Claude Code.** This app was built from `SITELINE_DEMO_SPEC.md`. This document changes how tasks are structured. Read it fully, then **inspect the codebase and present a plan before editing anything** (see §10). Where this document and the original spec disagree, **this document wins**. When the change is done, update `SITELINE_DEMO_SPEC.md` so it stays the source of truth (§9).

---

## 1. Summary of the change

| Before | After |
|---|---|
| Fixed, predefined phases (Civil, Electrical, False ceiling, …) | **Nothing predefined.** Each project creates its own structure. |
| `task.phase` string, list grouped by phase | **Parent and sub-tasks**, two levels only (`task.parentId`) |
| No location concept | **Areas**: a per-project list, two levels (floor › room). Each sub-task can have one area (`task.areaId`). |
| One task list layout | **"Group by: Work · Area"** switch on the task list |
| Phase totals ("3/7 done") | Parent, room and floor totals **calculated from sub-tasks** (never stored) |

Mental model: **parent = what work, area = where.** Area is a tag, not a third level of the tree.

---

## 2. Rules (enforce on the mock server, mirror in the app)

### 2.1 Tasks
1. **Two levels only.** A task with `parentId` set (a sub-task) cannot itself have sub-tasks. A task that has sub-tasks cannot be given a `parentId`.
2. A parent and its sub-tasks belong to the **same project**.
3. A task with no sub-tasks is a normal task (a "leaf"). **Adding the first sub-task turns it into a parent.** When that happens:
   - the new sub-task defaults to the parent's `areaId`, `ownerId`, `plannedStart`/`plannedFinish`;
   - the parent's own `areaId` is cleared (areas live on leaves);
   - if the task had progress (`percent > 0`, `actualStart`, or status other than `not_started`), the app first warns: *"This task's own progress will be replaced by its sub-tasks' progress."*
4. **Parents are summaries.** Once a task has sub-tasks, `plannedStart`, `plannedFinish`, `baselineStart`, `baselineFinish`, `actualStart`, `actualFinish`, `percent` and `status` **cannot be edited** on it (server returns `409 TASK_IS_PARENT`). `name`, `description`, `ownerId` and `sortOrder` stay editable. Stored values on a parent are ignored; always use the rollup.
5. **Work happens on leaves.** Check-ins, "My tasks", baseline locking and the "confirm done" flow apply to **leaf tasks only**.
6. **Deleting a parent** requires a choice: `DELETE /tasks/:id?children=delete` or `?children=promote` (sub-tasks become top-level). Without the parameter → `409 TASK_HAS_CHILDREN`.
7. **Moving:** `PATCH /tasks/:id { parentId, sortOrder }`. Target must be a top-level task in the same project, not the task itself, and the moved task must have no sub-tasks; otherwise `422 TASK_DEPTH_EXCEEDED`. `parentId: null` makes it top-level.
8. **Ordering:** `sortOrder` is a number among siblings (top-level tasks are siblings of each other). Insert between two tasks by averaging their values; new tasks go last (`max + 1`).

### 2.2 Areas
1. Areas belong to one project. Two levels: a **floor/zone** (`parentAreaId = null`) and a **room** (`parentAreaId` = a floor). A room cannot have children → `422 AREA_DEPTH_EXCEEDED`.
2. Tasks may point to a floor directly ("whole floor" work) or to a room, or have no area.
3. `areaId` on a task must belong to the task's project → `422 VALIDATION_FAILED`.
4. **Deleting an area** that has tasks or rooms requires `?moveTo=<areaId|none>` → otherwise `409 AREA_NOT_EMPTY`.
5. Areas are optional. A project with no areas just doesn't show the Area grouping (the switch is hidden).

### 2.3 Permissions
Add `"area.manage"` to the `manager` permissions in `src/shared/permissions.ts`. Creating, moving and deleting tasks and areas follow existing Manager rules. Members still update their own leaf tasks, and can pick an area when filing **Report issue** / **Daily report** (no new permission needed: they're choosing, not managing).

---

## 3. Data model changes

### 3.1 Types (`src/types/models.ts`)

```ts
interface Task {
  // REMOVE: phase: string;
  parentId: ID | null;     // null = top-level
  areaId: ID | null;       // set on leaf tasks
  sortOrder: number;
  // ...all other fields unchanged
}

interface ProjectArea {
  id: ID;
  projectId: ID;
  name: string;
  parentAreaId: ID | null; // null = floor/zone
  sortOrder: number;
  updatedAt: string;
  deletedAt: string | null;
}
```

### 3.2 Local SQLite
- `tasks`: drop `phase`; add `parent_id TEXT NULL`, `area_id TEXT NULL`, `sort_order REAL NOT NULL DEFAULT 0`. Index `tasks(project_id, parent_id, sort_order)` and `tasks(area_id)`. Remove the old `tasks(project_id, phase)` index.
- New table `project_areas(id, project_id, name, parent_area_id, sort_order, updated_at, deleted_at)`, index `(project_id, parent_area_id, sort_order)`.
- **Demo-only migration:** add `SCHEMA_VERSION = 2` stored in `kv`. On launch, if the stored version differs, **drop all tables, recreate, clear `lastSyncTime` and the outbox, and re-sync** from the mock server (which reseeds on reload). Show a one-time toast "Demo data updated." (A real app would need proper migrations; note this in `DECISIONS.md`.)

### 3.3 Shared rollup function (`src/shared/rollup.ts`)

Used by the app (task list, project overview, area views) **and** the mock server (`GET /dashboard`). Never store its results.

```ts
export interface Rollup {
  start: string | null; finish: string | null;
  baselineStart: string | null; baselineFinish: string | null;
  percent: number;            // 0–100, duration-weighted
  status: TaskStatus;         // derived
  doneCount: number; total: number;
  delayDays: number;          // max(0, finish - baselineFinish)
  lateCount: number;          // unfinished leaves past their own baselineFinish
}

export function rollup(leaves: Task[]): Rollup
```

Rules:
- `start` = earliest `plannedStart`; `finish` = latest `plannedFinish`.
- Baseline = earliest `baselineStart` to latest `baselineFinish` over leaves that have one; `null` if none.
- `percent` = Σ(percent × durationDays) / Σ(durationDays), where `durationDays = finish − start + 1` (minimum 1). Treat `done` as 100.
- `status`: all `done` → `done`; else any `blocked` → `blocked`; else any started (status ≠ `not_started` or percent > 0) → `in_progress`; else `not_started`. (`done_pending_confirmation` counts as started, not done.)
- `delayDays` uses whole days; 0 if no baseline.
- Empty input → return `null` (caller shows "No tasks yet").

Helpers in the same file:
- `leavesOf(parent, allTasks)` → its sub-tasks (or `[parent]` if it has none).
- `leavesInArea(areaId, allTasks, areas)` → leaves whose area is the area or (for a floor) any of its rooms.
- `isParent(task, allTasks)`.

Write unit tests for `rollup` (weights, status precedence, baseline null, delay vs late count, empty list).

---

## 4. Mock server changes (`src/mock/`)

### 4.1 Endpoints

| Method & path | Change |
|---|---|
| `GET /sync` | Add `projectAreas` and `removed.areas` |
| `POST /projects/:id/tasks` | Accept `parentId`, `areaId`, `sortOrder`; remove `phase`; enforce §2.1 |
| `PATCH /tasks/:id` | Accept `parentId`, `areaId`, `sortOrder`; reject rolled-up fields on parents (`TASK_IS_PARENT`); enforce move rules |
| `DELETE /tasks/:id?children=delete\|promote` | New |
| `GET /projects/:id/areas` | New (also included in sync) |
| `POST /projects/:id/areas` `{id, name, parentAreaId, sortOrder}` | New, idempotent by `id`, Managers |
| `PATCH /areas/:id` `{name, parentAreaId, sortOrder}` | New, Managers |
| `DELETE /areas/:id?moveTo=` | New, Managers |
| `POST /projects/:id/baseline/lock` | Copies planned → baseline on **leaf tasks only** |
| `GET /dashboard` | Add per-project `progressByFloor: {areaId, name, percent, delayDays}[]` using `rollup` |

### 4.2 New error codes
`TASK_IS_PARENT`, `TASK_HAS_CHILDREN`, `TASK_DEPTH_EXCEEDED`, `AREA_DEPTH_EXCEEDED`, `AREA_NOT_EMPTY`. Add English, Kannada and Hindi messages to i18n.

### 4.3 Events
- `task.updated` / `task.created` now carry `parentId`, `areaId`, `sortOrder`.
- New: `task.deleted` (with `promotedChildIds` when children were promoted), `area.created`, `area.updated`, `area.deleted` (with `movedTo`).
- **No parent event when a child changes.** Parent values are calculated on the client.

### 4.4 Check-ins and bot
- Only create check-ins for **leaf** tasks.
- Check-in title becomes `"<task name> · <room or floor name>"` (e.g. *"How is Gypsum boards · Master bedroom?"*). Context line: `"<parent name> · <project> · due <date>"`.
- Status cards posted to `#site-work` use the same naming.

### 4.5 Scripted teammates (`actors.ts`)
Replace "Amit shifts 5 task dates" with: "Amit shifts all sub-tasks of *Carpentry* by 2 days" (5 leaves), so the parent row and floor totals visibly recalculate.

---

## 5. Seed data (replace task seeds in `seed.ts`)

Remove every `phase` value and the predefined phase list. Keep the same users, projects, channels and messages, but **re-point any message/task card that referenced a removed task** to an equivalent new one.

### 5.1 Sharma Residence – Whitefield (Execution, baseline locked, ~4 days behind)

**Areas**
```
Ground floor:  Living room, Dining, Kitchen, Guest bedroom
1st floor:     Master bedroom, Kids' bedroom, Master bathroom, Balcony
```

**Parents and sub-tasks** (~32 leaves). Keep the original story: early work done, False ceiling in progress with one blocked task, Carpentry starting, later work not started.

| Parent | Sub-tasks (area) | State |
|---|---|---|
| Civil & demolition | Kitchen demolition (Kitchen), Bathroom demolition (Master bathroom), Debris removal (no area) | done |
| Electrical | Main DB panel (no area), Wiring (Ground floor), Wiring (1st floor), Switchboards (Living room) | done |
| Plumbing | Kitchen lines (Kitchen), Bathroom lines (Master bathroom), Pressure test (no area) | done |
| False ceiling | Grid framing (Living room) done; Gypsum boards (Living room) 75%; Grid framing (Master bedroom) done; Gypsum boards (Master bedroom) **blocked — "Material not arrived"**; Grid framing (Kids' bedroom) 0%; Gypsum boards (Kids' bedroom) 0% | in progress, **late** |
| Carpentry | Modular kitchen (Kitchen) 20%; Wardrobe carcass (Master bedroom); Wardrobe shutters (Master bedroom); Kids' wardrobe (Kids' bedroom); TV unit (Living room); Study table (Kids' bedroom) | starting |
| Painting | Putty & primer (Ground floor), Putty & primer (1st floor), Final coat (Ground floor), Final coat (1st floor) | not started |
| Handover | Deep cleaning (no area), Snag list (no area), Client walkthrough (no area) | not started |

Plus **one top-level leaf with no parent**: "Order light fixtures" (no area) — shows that parents are optional.

Ravi's open check-in now targets **Gypsum boards · Living room**.

### 5.2 Mehta Villa – Koramangala (Design, no baseline, **no areas**)
Parents: Concept (3 leaves), 3D renders (Living room render, Bedroom renders, Kitchen render as plain names), Material board (2 leaves), Client approval (1 leaf). No areas → the Area switch is hidden for this project.

### 5.3 Café Brew Fit-out – Indiranagar (Finishing, 1 day ahead)
Areas (single level, zones only): Seating area, Counter, Kitchen, Washrooms, Façade. Parents: Flooring, Counter & back bar, Lighting, Signage, Snag & handover (~18 leaves, mostly done).

---

## 6. App changes

### 6.1 Remove phases everywhere
Search the codebase for `phase` (types, DB, mock, seed, components, i18n, forms, filters, quick-add defaults, task detail breadcrumb) and remove or replace each use. Report the list of files in your plan.

### 6.2 Task list (`features/tasks`) — Managers and Owner/Admin

**Header:** project switcher (unchanged) + a segmented control **Group by: Work · Area** (hidden when the project has no areas). Remember the choice per project in the zustand UI store.

**Group by Work**
```
▾ False ceiling            ● 2/6 · 47%   18–29 Oct   4d
    ● Grid framing          Living room     Ravi   100%
    ◐ Gypsum boards         Living room     Ravi    75%
    ⊘ Gypsum boards         Master bedroom  Ravi     0%
    + Add sub-task
▸ Carpentry                ◐ 0/6 · 4%    25 Oct–8 Nov  2 late
  ○ Order light fixtures                    Amit     0%
+ Add a task…
```
- Parent row: chevron, rollup status dot, **bold name**, date range, `doneCount/total · percent%`, delay chip (`4d`, danger) or late chip (`2 late`, warning), a thin progress bar under the row, owner avatar if set. Collapsible; expansion state remembered.
- Sub-task rows indented **one level** (16 px), showing area (room name only; full "Floor › Room" in detail), owner avatar, mini timeline bar (planned vs baseline, as before), percent.
- Top-level leaves render as normal task rows at the parent level.
- "+ Add sub-task" inline at the end of an expanded parent; "Add a task…" quick-add at the bottom creates a top-level task.

**Group by Area**
```
GROUND FLOOR                         52% · 1d
 ▾ Living room                ◐ 3/5 · 70%
     ● Grid framing      False ceiling   100%
     ◐ Gypsum boards     False ceiling    75%
     ○ TV unit           Carpentry         0%
 ▸ Kitchen                    ◐ 2/4 · 55%
   Whole floor                ◐ 1/2 · 50%     (tasks set on the floor itself)
1ST FLOOR                            20% · 2 late
 ...
NO AREA                              ...
```
- Floors are **sticky section headers** (not indentation) with their rollup.
- Rooms are collapsible rows with their rollup; leaves under them show **parent name** as the subtitle.
- Tasks assigned to the floor itself appear under a "Whole floor" row; tasks with no area appear in a final **No area** section.
- Only **leaf** tasks appear in this view.

**Filters** (All · Mine · Delayed · Blocked · Done) apply to leaves. A parent/room/floor stays visible if any leaf inside matches, with "showing 2 of 6". Rollups always use **all** leaves, not just the filtered ones.

**Swipe actions** on leaves as before. On parent rows: swipe left → "Shift all sub-tasks" (−1/+1/+3/+7 days), producing one `update_task` per leaf.

**Long-press menu** on a task: Add sub-task (top-level tasks only) · Move to… (sheet listing top-level tasks + "Top level") · Change area · Move up / Move down · Delete (parent → choice sheet: "Delete 6 sub-tasks too" / "Keep sub-tasks as top-level tasks").

### 6.3 Quick-add defaults
- Top-level "Add a task…": start = day after the latest finish in the project (or project start), 3 days, no area, owner unassigned.
- "+ Add sub-task": start = day after the previous sibling's finish (or the parent's start), 3 days, **area = previous sibling's area**, owner = previous sibling's owner or the parent's owner.

### 6.4 Task detail sheet
- Breadcrumb: `Project › Parent` (or just `Project` for top-level).
- **Area** field (picker: floors and rooms, plus "No area", plus "+ New area" for Managers) — leaves only.
- **Parent** field: "Move to…" for Managers.
- **When the task is a parent:** show its rollup (dates, baseline, %, status, delay, late count) as **read-only**, a "Sub-tasks" list with progress bars and "+ Add sub-task", and hide the % slider, status selector and date editors. History still shows the parent's own changes (name, owner, moves).
- Converting a leaf with progress into a parent shows the warning from §2.1.3.

### 6.5 Areas management (new) — `project/[id]/areas.tsx`
Reached from Project overview (Managers) and from "+ New area" in pickers.
- List of floors with their rooms indented; each with task count.
- Add floor, add room (to a floor), rename, Move up/down, delete (sheet: "Move its 7 tasks to: [area picker] / No area").
- Members see the list read-only (or not at all if simpler; note it in `DECISIONS.md`).

### 6.6 Other screens
- **My tasks (Members):** leaf tasks only; subtitle `"<Parent> · <Floor › Room>"`. Unchanged layout otherwise.
- **Bot check-in card:** title and context per §4.4.
- **Project overview:** replace any phase summary with **"Progress by floor"** — a small bar per floor (percent, delay/late chip); hidden when the project has no areas. Progress ring = rollup of all leaves.
- **Forms:** *New task* replaces the Phase picker with **Parent** (optional, top-level tasks of the project) and **Area** (optional, leaves only). *Report issue* and *Daily report* get an optional **Area** picker; cards show the area.
- **Files tab:** filter chips by floor/room, using `data.areaId` on image messages and form cards (optional field; untagged items show under "All").
- **Dashboard:** in the delayed projects list, show the worst floor ("1st floor · 4d").
- **Activity batching:** "Amit shifted 5 sub-tasks in Carpentry · 2 are yours."

### 6.7 Outbox (keep all seven rules)
- New kinds: `create_area`, `update_area`, `delete_area`, `delete_task`. Moves and area changes on tasks use `update_task` (fields merge as before).
- Lanes: area operations → `project:<projectId>`; task operations → `task:<taskId>` as before.
- **Dependencies (important):**
  - Creating a sub-task whose **parent's `create_task` is still in the outbox** → `dependsOn` that item.
  - Creating/moving a task into an **area whose `create_area` is still pending** → `dependsOn` that item.
  - If the dependency fails permanently, the dependent fails with `DEPENDENCY_FAILED` ("because *False ceiling* couldn't be created").
- **Shift all sub-tasks:** one `update_task` per leaf (each in its own lane), created in one SQLite transaction.
- **Rule 6 (re-apply pending changes)** must include `parentId`, `areaId`, `sortOrder`.
- **Optimistic rules on the client mirror §2:** e.g. the app never lets a Manager drag a parent under another parent, so `TASK_DEPTH_EXCEEDED` should only appear if data changed elsewhere (then it's a normal permanent failure with rollback).

### 6.8 Sync and realtime
- Sync writes `projectAreas` and applies `removed.areas`.
- Handle `task.deleted` (remove the task; if `promotedChildIds`, those arrive as `task.updated` with `parentId: null`), `area.*` events.
- Screens compute rollups from live queries with `useMemo`; nothing else to invalidate.

---

## 7. Demo panel additions
- **Teammates:** "Amit shifts Carpentry by 2 days now".
- **Inject:** "Next task create → parent fails (403)" to demonstrate `DEPENDENCY_FAILED` on a pending sub-task.

---

## 8. Acceptance checks (add to the demo script)

1. Sharma Residence opens in **Group by Work**: parents collapse/expand, totals and delay/late chips match the seed story; "Order light fixtures" shows as a top-level task.
2. Switch to **Group by Area**: Ground floor and 1st floor headers with totals; rooms collapse; leaves show parent names; "No area" section at the end.
3. Mehta Villa: **no Area switch** (no areas).
4. As Ravi, set *Gypsum boards · Living room* to 100% via the check-in → as Amit, the False ceiling parent %, Living room and Ground floor totals update live.
5. As Amit, **add a sub-task** under Carpentry: defaults to the previous sibling's area and dates; appears in both views.
6. **Turn a leaf into a parent** (with progress) → warning shown; after confirming, its stored progress is replaced by the rollup and its date fields become read-only.
7. Try editing a parent's dates via any path → not possible in UI; mock rejects with `TASK_IS_PARENT` if forced.
8. **Move** a sub-task to another parent and to top level; try moving a parent under another parent → not offered in UI.
9. **Delete a parent** both ways (delete children / promote children).
10. **Areas screen:** add a floor and a room, rename, reorder, delete a room with tasks → tasks moved to the chosen area.
11. **Offline:** create a new parent and two sub-tasks, plus a new area used by one of them → outbox shows the dependencies (sub-tasks wait for the parent; task waits for the area); back online → all succeed in the right order.
12. Inject "parent create fails (403)" → both pending sub-tasks fail with *"because … couldn't be created"* and appear in Unsent.
13. **Teammates:** "Amit shifts Carpentry by 2 days" → five leaves update, Carpentry's dates move, one batched Activity item.
14. Bot check-in titles include the room; Report issue with an area shows it on the card; Files tab filters by room.
15. Kannada/Hindi: new error messages and labels translated; dark mode looks right on both views.

---

## 9. Keep the docs true
`SITELINE_DEMO_SPEC.md` **v1.1** (delivered with this document) already contains every change described here. After implementing:
- **Replace** the repo's `SITELINE_DEMO_SPEC.md` with v1.1 (don't hand-edit the old one), and check the code matches its §5.7, §5.8, §5.14, §7.5, §10 and §11.
- Add to `CLAUDE.md`: *"Tasks have two levels (parentId) and an optional area. Parent and area totals are always calculated with src/shared/rollup.ts and never stored. Nothing about phases or areas is hard-coded."*
- Add checks 17–21 from the spec's §14 to your demo run-through.
- Record judgement calls in `DECISIONS.md`.

---

## 10. How to work through this

1. **Plan first (no edits):** list every file that uses `phase` or the task list grouping, the files you'll add, the DB/seed reset approach, and the order of work. Wait for approval.
2. `src/shared/rollup.ts` + unit tests.
3. Types, local DB schema v2 + reset, mock db/seed, mock routes, error codes, events, sync.
4. Outbox kinds and dependencies; outbox tests for the new dependency cases.
5. Task list: Group by Work, then Group by Area; quick-add, long-press menu, swipe on parents.
6. Task detail (parent mode), Areas screen.
7. My tasks, bot naming, forms, Files filter, project overview, dashboard, Activity text.
8. Demo panel additions, i18n, dark mode pass.
9. Run every check in §8, then replace the spec and update `CLAUDE.md` (§9).

Commit after each step with a clear message.

---

## Planning notes (added when this change was parked)

Not part of the original change document. Recorded after inspecting the codebase (step 1 of §10)
so the work can be picked up later without repeating it.

### Decisions still open

1. **Project names.** This document uses Sharma Residence, Mehta Villa and Café Brew. The app has
   since been renamed to **Villa 99**, **RV University** and **OITH** (company: Paliath Interiors).
   Proposed: keep the new names and map the seed onto them — Villa 99 gets the floors and rooms
   (§5.1), RV University has no areas (§5.2, with sub-task names adapted to a campus), OITH gets
   the zones (§5.3).
2. **Spec v1.1 is not in the repo.** §9 says to replace `SITELINE_DEMO_SPEC.md` with a v1.1 that
   was "delivered with this document"; only the original is present. Either add the v1.1 file, or
   decide that the existing spec is updated by hand. "Checks 17–21 from §14" cannot be run without it.
3. **Unit tests need a test runner.** None is installed. Proposed: Jest via `jest-expo` as a dev
   dependency, for the rollup and outbox-dependency tests.

### What uses phases today (62 references in 13 files)

- Types and rules: `src/types/models.ts`, `src/shared/schemas.ts`, `src/shared/taskRules.ts`
- Local database: `src/lib/db/schema.ts`, `src/lib/db/init.ts`
- Mock server: `src/mock/seed.ts`, `src/mock/routes/tasks.ts`
- Task screens: `src/features/tasks/api.ts`, `src/features/tasks/hooks.ts`,
  `src/features/tasks/components/ScheduleList.tsx`, `app/task/[id].tsx`
- Chat: `src/features/chat/components/forms.tsx` (New task form),
  `src/features/chat/components/renderers.tsx` (task card)
- Generated strings: `src/lib/i18n/en.json`

### Files to add

- `src/shared/rollup.ts` and its tests
- `src/mock/routes/areas.ts`
- `src/features/areas/` (hooks, writes, area picker)
- `app/project/[id]/areas.tsx`
- Outbox handlers for areas and task deletion, plus dependency tests
- A Work/Area task list replacing `ScheduleList.tsx`, split into smaller files

### Things that have changed in the app since this document was written

- The local database is already dropped on every launch (the mock server's memory is lost on
  reload). `SCHEMA_VERSION = 2` should still be added as §3.2 asks, so it is in place when that
  launch-time drop is removed for a real backend.
- The bot now asks about every open task the user owns when its conversation is opened, cards
  have no emoji, and each card has an optional typed/recorded note. Those stay; only the card
  title and context line change to the naming in §4.4. "Leaf tasks only" (§2.1.5) must be applied
  to that open-time batch as well.
- Sheets use the in-house `Sheet` component, not `@gorhom/bottom-sheet`.
- The owner and the admin were given tasks of their own in the seed; the new seed should keep at
  least one leaf owned by each.

### Proposed defaults where the document leaves a choice

- Areas screen for Members: read-only list.
- Reordering by "Move up / Move down" (as written), no drag-and-drop.
