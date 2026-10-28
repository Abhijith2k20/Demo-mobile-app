# Demo-mobile-app

Siteline: a clickable demo of a project chat and task app for Paliath Interiors.

- **App** (`frontend/`): Expo SDK 57, runs in Expo Go. A thin client: it shows what the server says. Messages, photos, check-ins and task updates wait in a send queue when offline, and the last loaded screens are kept on the phone.
- **Backend** (`backend/`): FastAPI mock server with in-memory demo data. All data, permissions and rules live here.

## Run it

```bash
# 1. Backend (Python 3.11+)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. App (another terminal)
cd frontend
npm install
npx expo start          # scan the QR code with Expo Go
```

The app finds the server on the same computer that runs Expo (port 8000).
- **Phone on the same Wi-Fi:** works as is (allow port 8000 through the Mac firewall if asked).
- **Android emulator:** run `adb reverse tcp:8000 tcp:8000` once.
- **Somewhere else:** set `EXPO_PUBLIC_API_URL=http://<host>:8000` before `npx expo start`.

Sign in with any demo account (e.g. `ravi@paliath.in`); the code is always `123456`.
API docs: http://localhost:8000/docs

## Checks

```bash
cd frontend
npm run typecheck && npm run lint && npm test
npm run test:api        # backend tests (pytest)
```

- Spec: `SITELINE_DEMO_SPEC.md`
- Changes from the spec: `DECISIONS.md`
- Project rules: `CLAUDE.md`
