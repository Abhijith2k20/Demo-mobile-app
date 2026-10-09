# Siteline demo — rules
- Read SITELINE_DEMO_SPEC.md before any change. It is the source of truth.
- Must run in Expo Go. Do not add libraries that need a dev build.
- Files in app/ are routes only: read URL params and render a screen from src/features/<area>/screens/. No layout or logic in app/ (except _layout files).
- Screens never call the API or DB directly; use feature hooks.
- All writes go through the outbox (one transaction with the local change).
- Never import from src/mock outside src/lib/api/transport.ts and the Demo panel.
- Permissions come only from src/shared/permissions.ts (server enforces, app hides).
- Errors: services/routes return the standard error format; the app shows translated messages by code.
- Colours, spacing and type only from src/theme. No hard-coded colours.
- Record any deviation from the spec in DECISIONS.md.

@AGENTS.md

