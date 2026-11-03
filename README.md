# Siteline

A work chat for field teams, with a bot that asks task owners for status, for many companies.
Spec: `SITELINE_SPEC.md` (2.0, the MVP). Changes from it: `DECISIONS.md`. Project rules: `CLAUDE.md`.

- **App** (`frontend/`): Expo SDK 57, built with EAS (development, preview, production). A thin client:
  it shows what the server says. Messages, photos, voice notes, files and card answers wait in a send
  queue when offline; the last loaded screens are kept on the phone, per person and company.
- **Backend** (`backend/`): FastAPI on Postgres with row-level security per company, a worker for the
  bot's timed jobs, and a mock PM app that stands in for each company's PM app until its API exists.

## Run it locally

```bash
# 1. Database (Docker), then the API with a worker inside it (Python 3.13)
cd backend
docker compose up -d
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env      # settings (SITELINE_ENV=development); every key is listed and explained there
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --env-file .env
#   An empty database is seeded: Paliath Interiors and Brightline Events. Every code is 123456.
#   Platform panel: http://localhost:8000/platform (admin@siteline.app). API docs: /docs

# 2. The app (another terminal)
cd frontend
npm install
cp .env.example .env      # optional: EXPO_PUBLIC_API_URL to point the app at another API
npx expo start            # a development build (npm run build:dev) for push; `--go` for a quick look in Expo Go
```

The app finds the server on the computer running Expo (port 8000), or at `EXPO_PUBLIC_API_URL`.
On the Android emulator run `adb reverse tcp:8000 tcp:8000` once.

## Checks

```bash
cd frontend
npm run typecheck && npm run lint && npm test
npm run test:api          # backend tests (pytest, against the Docker Postgres)
```

CI runs the same on every push (`.github/workflows/checks.yml`).

## Deploy

`render.yaml` describes the API, the worker and Postgres (Singapore). Before going live you need:
Render, Cloudflare R2, Resend (email), Sentry, an Expo/EAS
project (its id in `app.json` → `extra.eas.projectId`, for push), and store developer accounts.
Set the secrets listed in `render.yaml` (and `backend/.env.example`) in Render. Set `EXPO_PUBLIC_API_URL` in the Expo
dashboard (Environment variables, plain text) for the `preview` and `production` environments; publish updates with
`eas update --environment production` so they get it too.
