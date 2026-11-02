# Siteline — rules
- Two folders: frontend/ (the Expo app; run npm and npx there) and backend/ (FastAPI on Postgres; `docker compose up -d` there first). Paths like app/ and src/ below are inside frontend/.
- Read SITELINE_SPEC.md before any change. It is the source of truth (version 2.0, the MVP; DECISIONS.md lists what differs).
- The app runs as an EAS development build, not in Expo Go. Add libraries with `npx expo install`; configure native behaviour in app.json and config plugins, never in ios/ or android/.
- Multi-company: every per-company record carries company_id, the company comes from the session (never the request), and another company's ids answer 404. Tenant-separation tests must cover every new route.
- Projects, tasks and every rule about chasing them belong to the PM app. Siteline only delivers its cards and sends answers back (Cards API: docs/CARDS_API.md). Siteline keeps no copy of tasks and decides nothing about them; the mock PM app (backend/app/mockpm) uses the same API the real one will.
- Files in app/ are routes only: read URL params and render a screen from src/features/<area>/screens/. No layout or logic in app/ (except _layout files).
- Features never import each other in a loop, and src/features/shared imports no feature (checked by a test). Put a piece two features need in shared.
- Screens never call the API directly; use feature hooks (reads) and feature api.ts functions (writes).
- The app is a thin client: business rules, permissions and calculations live only in backend/app (rules.py, views.py). The app shows what the server returns (access.permissions, can* flags, computed fields) and never re-derives them.
- Only src/lib/api/transport.ts knows the server address. The dev panel (development and preview builds only) uses /internal/* through src/features/demo/api.ts; production refuses those routes.
- Server data is TanStack Query cache, refreshed by WebSocket events; the last loaded data is saved to the phone (src/lib/persist.ts) only to show while offline.
- Site actions (messages and photos, check-in answers) go through the send queue (src/lib/outbox.ts). Everything else is online-only. The phone never works out results: queued items show as "sending" until the server answers.
- Database: plain SQL through backend/app/db.py; schema changes are new files in backend/db/migrations (never edit one that ran in staging or production). Per-company tables get company_id and the row-level security policy.
- Timed or retried work (bot check-ins, reminders, PM writes, sync, email/SMS/push) is a job (backend/app/jobs), queued in the same transaction as the change.
- Backend: routers translate HTTP only; business actions live in backend/app/services, rules in rules.py, visibility in access.py. Only main.py imports routers (checked by a test). Backend changes need tests in backend/tests; run `npm run test:api`.
- Errors: services/routes return the standard error format; the app shows translated messages by code.
- Colours, spacing and type only from src/theme. No hard-coded colours.
- Record any deviation from the spec in DECISIONS.md.

@AGENTS.md

