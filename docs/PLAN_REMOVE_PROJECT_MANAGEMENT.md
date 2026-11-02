# Plan — remove project management from Siteline

> **Status: done (2026-11-02).** See DECISIONS.md "Build step 2" for what differed. Build step 2 of `SITELINE_SPEC.md` §15. What gets removed is listed in spec §0.1;
> this file says **in what order**, so the app and the bot keep working after every step.

## Why this order

The bot depends on Siteline's own tasks today:
- `backend/app/bot.py` reads `S().tasks` to choose what to ask;
- check-in answers call `services/tasks.apply_task_changes`;
- the app's `CheckinCard`, `MorningSummary` and `renderers.tsx` load each task separately with `useTask` /
  `useTasksByIds` from `features/tasks/hooks.ts`.

Deleting the task code first would break the bot. So the tasks first move behind the **PM connector**, with a
**mock PM** holding the seeded tasks; then the old task code is deleted.

The cleanup is done **on the current in-memory backend, before Postgres** (build step 3), so no tables are
designed or migrated for features that are being deleted.

## Steps

Each step ends with `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:api` passing, and one commit.

### 1. PM connector and mock PM (backend)

- Add `backend/app/pm/connector.py`:
  - `list_projects()`;
  - `list_members(project)`;
  - `list_tasks(project=None, owner=None)`;
  - `get_task(id)`;
  - `write_status(task_id, answer, key)`.
- Add `backend/app/pm/mock.py`, in memory for now, implementing the connector.
- Move the seeded tasks from `seed.py` into the mock PM's data. Keep the same names, dates and owners, so the
  demo story stays the same.
- Tests: the mock answers `list_tasks` by owner, and `write_status` with the same key twice writes once.

### 2. Bot reads and writes through the connector (backend)

- `bot.py`:
  - `open_tasks_for` uses `connector.list_tasks(owner=...)` with the active/overdue rule from spec §8.1;
  - the escalation's work channel comes from the task's project space;
  - answers call `connector.write_status` instead of `apply_task_changes`.
- **Check-ins carry their own task details**: `CheckinView` gets task name, project name, due date,
  `isOverdue`, percent and `queuePosition`. The morning summary message stores the rows it shows. The app
  stops loading tasks separately.
- Tests: the existing check-in, reminder, escalation and morning-summary tests pass against the mock; an answer
  shows up in the mock PM; "Not started" writes nothing.

### 3. App: bot and chat stop using the tasks feature

- `features/bot/components/CheckinCard.tsx` and `MorningSummary.tsx`: render from the check-in or message data;
  drop `useTask` / `useTasksByIds`.
- `features/bot/queue.tsx`: move `useMyCheckins` into `features/bot/hooks.ts`.
- `features/chat/components/renderers.tsx`:
  - delete the `task_card` renderer;
  - the status card no longer links to `/task/:id`;
  - unknown types keep the "Update the app" fallback.
- `features/chat/components/forms/IssueSheet.tsx`: "Related task" lists the project's tasks from
  `GET /projects/:id/tasks` (read-only, from the mock PM).
- `features/activity/screens/ActivityScreen.tsx`: items no longer open `/task/:id`.
- Check on the emulator: the bot queue, answering, the status card, the morning summary and Report issue all work.

### 4. Delete the app side

- **Routes:** `app/(app)/tasks.tsx`, `app/task/[id].tsx`; remove the tab from `app/(app)/_layout.tsx`.
- **The whole feature:** `src/features/tasks/` (screens, components, `filters.ts` and its test, hooks,
  `api.ts`).
- **Forms and menus:**
  - `chat/components/forms/NewTaskSheet.tsx` and its entry in the "+" sheet;
  - "Create task from message" in the message menu.
- **Projects:**
  - `projects/components/StageBanner.tsx`;
  - from `ProjectOverview.tsx`, the stage stepper, key dates, progress ring and "days behind"; rename it to
    **Info** (spec §5.6);
  - remove the Tasks segment from `ProjectScreen.tsx`.
- **Shared code:**
  - `StagePill` in `components/basics/identity.tsx`;
  - `useStages` in `shared/display.ts`;
  - `stageColors` and the `execution` tokens in `theme/colors.ts`;
  - the delay indicator on `HomeScreen.tsx`;
  - task previews on `DmsScreen.tsx`;
  - `task_card` in `Conversation.tsx`.
- **Types and contract:**
  - task types and fields from `types/models.ts` (`Task`, `TaskView`, `TaskHistory`, `delayDays`,
    `progress`, `nextStage`, `varianceDays`, `isLate`, `isDelayed`, `Stage`);
  - task schemas from `contract/schemas.ts`;
  - task keys from `lib/queries.ts`;
  - task items from `lib/outbox.ts` (only messages and check-in answers stay queued).
- **Translations:** run `node scripts/extract-i18n.mjs`, then remove the unused keys from `kn.json` and
  `hi.json`.
- **Boundaries:** update `src/features/__tests__/boundaries.test.ts` (no `tasks` feature).

### 5. Delete the server side

- `routers/tasks.py` (keep a read-only `GET /projects/:id/tasks` served from the connector, for Report issue),
  `services/tasks.py`, and the router's registration in `main.py`.
- **`rules.py`:**
  - delete `normalize_task_change`, `task_variance_days`, `task_is_late`, `task_is_delayed`, `ordered_phases`,
    `current_phase`, `task_defaults`, `PENDING_STATUSES`, `DUE_WINDOWS`, `matches_task_filters`,
    `project_delay_days`, `stage_keys`, `next_stage`, `MEMBER_EDITABLE`;
  - delete the task and stage permissions;
  - keep `PERCENT_STEPS` (check-in scale).
- **`views.py`:** drop task views and the project fields `delayDays`, `progress`, `nextStage`.
- **`routers/projects.py`:** drop `stage`, start/finish/baseline fields and the stage system message.
- **`store.py`:** drop `tasks`, `task_history`.
- **`schemas.py`:** drop task models.
- **`notify.py`:** drop task-change batching.
- **`events.py`:** drop `task.*` events.
- **`actors.py`:** drop "Amit shifts 5 tasks".
- **`routers/internal.py`:** drop task triggers.
- **`seed.py`:** drop `stages` and `phases` from the setup, and the project stage and dates.
- **Tests:** delete task tests in `test_api.py` and `test_rules.py`; keep the setup tests that still apply
  (job titles, channels, problem types).

### 6. Final check

- `grep` for `task_card`, `baseline`, `stage`, `phase`, `useTask`, `/task/`, `apply_task_changes`: only the PM
  snapshot and check-ins remain.
- Emulator walk-through with the current demo accounts:
  - sign in as Ravi;
  - answer every check-in;
  - status cards appear in `#site-work`;
  - Amit sees the escalation;
  - Report issue with a related task;
  - project Info, Members and Files open;
  - no screen links to a task.
- Update `DECISIONS.md` with anything done differently, and the README's "what's built".

## Not in this plan

- Postgres, accounts and companies (build step 3 onward).
- The real PM API (`pm/http.py`).
- Job scheduling by company time: the in-memory timers stay until build step 6.
