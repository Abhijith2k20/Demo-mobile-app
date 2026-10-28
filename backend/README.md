# Siteline mock backend (FastAPI)

In-memory data seeded on start (`app/seed.py`). It owns every rule: permissions (`app/rules.py`),
task consequences, unread counts, delays, the bot, notifications. The app only displays results.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
.venv/bin/pytest            # tests
```

| Setting | Default | Meanin
|---|---|---|
| `SITELINE_DEMO` | `1` | `0` removes the `/internal/*` Demo panel routes |
| `SITELINE_ACTORS` | `1` | `0` stops the scripted teammates |

- Interactive docs: `/docs`. Live events: `WS /ws?token=<access token>`.
- Data resets on restart or `POST /internal/reset`. Uploaded photos are kept in `uploads/`.
- This is a mock: no database, single process, tokens in memory. For production, replace `store.py`
  with a database layer and put `/files` behind signed URLs; the routes and rules stay.
