# Change 02 — Multi-tenant: many companies on one Siteline

> **Status: NOT STARTED — parked for later.** Nothing in this document has been implemented yet.
> The three product decisions in §2 were made by the owner on 2026-10-23. The open questions
> in §10 still need answers before building.

> **Note (2026-10-26):** the in-app mock server is gone. Read `src/mock/...` below as
> `backend/app/...` (e.g. `src/mock/db.ts` → `backend/app/store.py`, `routes/*.ts` → `routers/*.py`).

> **For Claude Code.** This app was built from `SITELINE_DEMO_SPEC.md`, which assumes one company.
> This document makes Siteline a multi-tenant product. Read it fully, then **inspect the codebase
> and present a plan before editing anything** (§11). Where this document and the spec disagree,
> **this document wins**. When the change is done, update `SITELINE_DEMO_SPEC.md` so it stays the
> source of truth, and record anything you did differently in `DECISIONS.md`.

---

## 1. Summary of the change

| Before | After |
|---|---|
| One company (Paliath Interiors), created by the seed | **Many companies** on the same server, each fully isolated |
| Company name and "PI" tile hard-coded in four screens | Name and initials come from the signed-in user's **company record** |
| `User` has no company; everyone is in the one company | Every `User` belongs to **exactly one** company (`companyId`) |
| Server routes return all users, projects and channels | Every route is **scoped to the caller's company**, taken from the token |
| No way to add a company | **The Siteline team creates companies** (in the demo: the Demo panel) |

Mental model: **a company is a sealed box.** Nothing inside one box (people, projects, channels,
messages, tasks, check-ins, activity, files) is ever visible from another box. The app itself
barely changes, because a person only ever sees their own box.

---

## 2. Product decisions (made)

| Question | Decision | What it means |
|---|---|---|
| How does a new company get onto Siteline? | **Created by the Siteline team only** | No "Create a company" in the app. A sales-led setup: we create the company and its Owner, and the Owner adds everyone else. |
| Can one login belong to more than one company? | **No, one company per login** | Sign-in is by **work email** (changed 2026-10-26), and the email decides the company. No workspace picker, no switcher. Someone working for two firms uses each firm's email. |
| Build now or write up first? | **Write up first** | This document. |

---

## 3. Rules (enforce on the mock server, mirror in the app)

1. **Every record belongs to one company.** `companyId` is required on users, projects, channels
   (including company channels, DMs and the bot DM), and is derivable for everything below a
   project or channel (members, messages, tasks, task history, check-ins, activity, uploads).
2. **The company comes from the token, never from the request.** The server looks up the caller's
   `companyId` from their session. Any `companyId` in a request body is ignored. A request for an
   ID that exists in another company returns **`NOT_FOUND`**, not `FORBIDDEN`, so IDs from other
   companies can't even be probed.
3. **Emails are unique across all companies** while the user is active (compared in lower case).
   Sign-in finds the one active user with that email; that user's company is the session's company.
4. **Leaving a company frees the email.** When a user is archived (spec: "archive, never delete"),
   their email can be used for a new user in another company. The archived user keeps their
   history under their name.
5. **Events never cross companies.** `publish()` already delivers to named users only; every
   caller must pick those users from the same company. Add a guard that drops (and logs) any
   delivery to a user in another company.
6. **Directory, search and DMs are per company.** `GET /users`, the New message sheet, "Add
   member" and @mention suggestions only list people in the caller's company. A DM can only be
   created between two people in the same company.
7. **The bot is per company.** Each company has its own Siteline Bot user and bot DMs, so bot
   messages and check-ins are company records like any other (simplest option; see §10.4).
8. **Company channels are per company.** Each company gets its own `#announcements` and `#general`
   when it is created.
9. **Roles are per company.** `companyRole` (Owner / Admin / Member) applies inside the user's own
   company only. There is no cross-company role in the app. The Siteline team acts through the
   Demo panel (and, in production, an internal admin tool), never as an in-app user.

---

## 4. Data model changes (`src/types/models.ts`, `src/lib/db/schema.ts`)

```ts
interface Company {
  id: ID;
  name: string;        // "Paliath Interiors"
  initials: string;    // "PI", shown in the logo tile (1–3 letters)
  createdAt: string;
  updatedAt: string;
}

interface User {
  // ...existing fields
  companyId: ID;       // NEW, required
}
```

- **Local DB:** add a `companies` table holding the one company the signed-in user belongs to,
  and `company_id` on `users`. Projects and channels already have `company_id`.
- **Sync:** `GET /sync` returns `company` (the caller's company record) alongside the existing
  lists, so the header can show the name offline.
- **Client creates:** `createProject`, `createChannel` and DM creation currently read `companyId`
  from the first local project/channel row (`src/features/projects/api.ts:16`,
  `src/features/chat/api.ts:256`). Replace that with the signed-in user's `companyId`. The server
  ignores it anyway (§3 rule 2), but the optimistic local row should be right.

---

## 5. Mock server changes (`src/mock/`)

| File | Change |
|---|---|
| `db.ts` | `MockStore.companyId` (single) becomes `companies: Map<ID, Company>`. `botId` becomes a per-company map (`botIds: Map<companyId, ID>`). Tokens store `companyId` next to `userId`. |
| `access.ts` | New helper, e.g. `scope(userId)`, returning the caller's `companyId`; every visibility check (`visibleProject` etc.) also checks `record.companyId === caller.companyId`. |
| `routes/auth.ts` | OTP verify finds the active user by email across all companies (rule 3) and puts `companyId` in the session. |
| `routes/sync.ts`, `routes/misc.ts` | Filter every list by the caller's company (`/sync`, `/users`, `/dashboard`, `/activity`). The Owner's "sees all projects" means all projects **in their company**. |
| `routes/projects.ts`, `channels.ts`, `messages.ts`, `tasks.ts` | Look up by ID, then return `NOT_FOUND` if the record's company differs (rule 2). New rows take `companyId` from the session. |
| `events.ts` / `notify.ts` | Cross-company guard (rule 5). |
| `bot.ts` | Run check-ins, reminders and the morning summary per company, using that company's bot. |
| `seed.ts` | Seed **two** companies (§7). |
| `server.ts` | New internal routes for the Demo panel only: `POST /internal/companies` (name, initials, owner name + work email) which creates the company, its Owner, its bot and its two company channels; `GET /internal/companies` for the list. Not reachable from app screens. |

New error codes: none needed. `EMAIL_TAKEN` (409) only if §10.2 is answered "check at creation".

---

## 6. App changes

- **Company name and tile from data.** Replace the hard-coded "Paliath Interiors" and "PI" in
  `HomeScreen.tsx:153`, `AuthShell.tsx:53`, `YouScreen.tsx:62`, `DashboardScreen.tsx:13` and
  `CompanyTile.tsx:11` with a `useCompany()` hook reading the local `companies` row.
- **Sign-in screen before sign-in:** it doesn't know the company yet, so it shows **Siteline**
  branding (app name, neutral tile) instead of a company name. After sign-in, the header shows
  the company.
- **Sign-in flow itself is unchanged:** work email → code → in. No workspace picker (§2).
- **Help line on the sign-in screen** stays: "Can't sign in? Ask your company admin to add your
  work email." Add a line for new firms: "New to Siteline? Contact us to set up your company."
  (copy to confirm, see §10.5).
- **User switch / logout:** already wipes the local DB, so switching to a user in another company
  needs no new handling. Verify it in the checks (§8).
- **Demo panel:** new section **"Companies"**: the list of companies, and **Create company** (name,
  initials, Owner name, Owner work email). The "Who am I" list groups demo users by company.
- **Invite person** (built 2026-10-26 for the single company, You → Company): with multi-tenancy the
  server puts the invited person in the inviter's company, and `EMAIL_TAKEN` checks across all
  companies (rule 3).
- **Permissions:** `src/shared/permissions.ts` needs no change; roles are still per company.

---

## 7. Seed data

- **Paliath Interiors** stays exactly as it is today (all projects, people, emails, messages), so
  every existing demo step still works.
- **A second company** with a small, separate set: an Owner, a Project Manager and a Worker, one
  project with a few tasks and messages, its own bot and company channels. Name to confirm
  (§10.1); placeholder "Second Company". Emails on its own domain (e.g. `owner@second.example`), same demo code
  `123456`.
- Purpose: show that signing in as the second company's Owner shows **none** of Paliath's people,
  projects, channels, DMs or dashboard numbers.

---

## 8. Checks (add to §14 of the spec and to tests)

1. Sign in as Paliath's Owner: Home, DMs, Dashboard, directory and search show only Paliath.
2. Switch to the second company's Owner: none of Paliath's projects, people, channels or numbers
   appear anywhere; header shows the second company's name and initials.
3. Request a Paliath project, channel, task or message ID while signed in to the second company:
   `NOT_FOUND` (mock server test).
4. "New message" and "Add member" only list people in your own company.
5. Events: a message in Paliath produces no event for any user of the second company (test).
6. Create a company from the Demo panel, sign in as its new Owner: an empty Home with
   `#announcements`, `#general` and the bot DM, and the Owner can create a project.
7. An email already active in one company can't be used for another company's user;
   after that user is archived, it can.
8. The bot's morning summary and check-ins in one company never mention another company's tasks.

Tests: add a `src/mock/__tests__/tenancy.test.ts` covering checks 3, 5, 7 and 8 against the mock
server directly. Isolation is a security property, so it gets tests, not only demo steps.

---

## 9. Spec updates when done

- §1/§11: "Company in seed data" becomes "two companies in seed data".
- §7 types: `Company`, `User.companyId`, the `companies` local table, `company` in the sync reply.
- §9 roles: roles apply within one company; the Siteline team creates companies.
- §10 mock server: per-company scoping rule, internal company routes, per-company bot.
- §5.1 sign-in: Siteline branding before sign-in.
- §5.12 Demo panel: Companies section.
- §14: the checks in §8.

---

## 10. Open questions (answer before building)

1. **Name of the second seeded company.** Any fictional interiors firm.
2. **Email already in use.** When the Siteline team (or an Owner adding a member) enters an email
   that is active in another company: refuse with "This email is already used by another
   company" (suggested), or allow it and let the newer one win?
3. **Company settings.** Can the Owner rename the company or change its initials in the app
   (suggested: yes, Owner only, under You → Company), or only the Siteline team?
4. **Bot per company or one shared bot user** with per-company DMs? Per company is simplest and
   safest (suggested).
5. **"Contact us" line** on the sign-in screen: show it, and with what contact (email or phone)?
6. **Closing a company.** Out of scope for the demo (suggested), but note the rule for later:
   archive the company, revoke all sessions, keep the data for a set period.

---

## 11. How to build it (for Claude Code)

1. Inspect the files in §5 and §6, list every place that assumes one company, and present the
   plan. Wait for approval.
2. Server first: model, scoping helper, routes, events guard, bot, seed. Write the tenancy tests
   and make them pass before touching the app.
3. Then the app: `companies` table and sync, `useCompany()`, the five hard-coded places,
   sign-in branding, create-row `companyId` fix.
4. Then the Demo panel: Companies section and grouped "Who am I".
5. Run lint, typecheck and tests; walk the §8 checks on the emulator; update the spec and
   `DECISIONS.md`.

---

## Planning notes (from inspecting the code on 2026-10-23)

- The local DB already has `company_id` on `projects` and `channels`, and the mock store has a
  single `companyId` used when creating projects, channels and DMs
  (`routes/projects.ts:144,160`, `routes/channels.ts:114`, `routes/messages.ts:247`).
- `User` has `companyRole` but no `companyId` (`src/types/models.ts:24`).
- `publish(event, userIds)` in `src/mock/events.ts` already targets named users only, so rule 5
  is a guard on top of existing behaviour, not a rewrite.
- Sign-in looks a user up by email across the whole store (`routes/auth.ts:50`), which already
  matches rule 3 once emails are unique across companies.
- The bot is a single user (`MockStore.botId`), so `bot.ts` is the largest single piece of work.
- The local DB is wiped on user switch and dropped on every launch, so no local migration is
  needed for the demo.
