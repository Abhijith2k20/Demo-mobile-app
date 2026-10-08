# Siteline — demo app

A clickable demo of an internal project-communication app for an interior design company
(fictional: **Paliath Interiors**). It runs entirely on the phone against an in-process mock
backend. Spec: [`SITELINE_DEMO_SPEC.md`](SITELINE_DEMO_SPEC.md). Deviations and open points:
[`DECISIONS.md`](DECISIONS.md).

## Run it

```bash
npm install
npx expo start
```

Then open the project in **Expo Go** (scan the QR code, or press `a` for an Android emulator).
Expo SDK 57 — use a matching Expo Go.

Sign in with any of the seven demo people on the login screen; the code is always `123456`.

## Finding your way around

- **Demo pill** (floating, bottom-left): opens the Demo panel — switch user, change the network,
  inject errors, trigger the bot and teammates, watch the outbox, read the API/event log, reset.
- **§14 of the spec** is the demo script; each scenario can be played from the Demo panel.
- Reloading the app resets everything (the mock server lives in memory).

## Code map

```
app/                 screens (Expo Router)
src/features/        one folder per feature: hooks, api (writes), components
src/lib/api/         api client + transport.ts (the only link to the mock; swap for fetch later)
src/lib/db/          local SQLite (drizzle) — every screen reads from here via live queries
src/lib/outbox/      queued writes: lanes, merge, retry, handlers (the seven rules)
src/lib/sync/        catch-up sync + applying incoming records
src/lib/realtime/    live events
src/mock/            in-process mock server (same endpoints/errors/events as the planned API)
src/shared/          permissions, zod schemas and task rules shared by app and mock server
src/theme/           colours, type, spacing
```

## Checks

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint
npm run i18n         # regenerate en.json from the English defaults in code
```
