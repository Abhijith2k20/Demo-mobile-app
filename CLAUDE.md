# Siteline demo — rules
- Two folders: frontend/ (the Expo app; run npm and npx there) and backend/ (FastAPI). Paths like app/ and src/ below are inside frontend/.
- Read SITELINE_DEMO_SPEC.md before any change. It is the source of truth.
- Must run in Expo Go. Do not add libraries that need a dev build.
- Files in app/ are routes only: read URL params and render a screen from src/features/<area>/screens/. No layout or logic in app/ (except _layout files).
- Features never import each other in a loop, and src/features/shared imports no feature (checked by a test). Put a piece two features need in shared.
- Screens never call the API directly; use feature hooks (reads) and feature api.ts functions (writes).
- The app is a thin client: business rules, permissions and calculations live only in backend/app (rules.py, views.py). The app shows what the server returns (access.permissions, can* flags, computed fields) and never re-derives them.
- Only src/lib/api/transport.ts knows the server address. The Demo panel uses /internal/* through src/features/demo/api.ts.
- Server data is TanStack Query cache, refreshed by WebSocket events; the last loaded data is saved to the phone (src/lib/persist.ts) only to show while offline.
- Site actions (messages and photos, check-in answers, task progress/status) go through the send queue (src/lib/outbox.ts). Everything else is online-only. The phone never works out results: queued items show as "sending" until the server answers.
- Backend: routers translate HTTP only; business actions live in backend/app/services, rules in rules.py, visibility in access.py. Only main.py imports routers (checked by a test). Backend changes need tests in backend/tests; run `npm run test:api`.
- Errors: services/routes return the standard error format; the app shows translated messages by code.
- Colours, spacing and type only from src/theme. No hard-coded colours.
- Record any deviation from the spec in DECISIONS.md.

@AGENTS.md

