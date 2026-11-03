"""Rendering for the platform panel (server-rendered pages for the Siteline team). The pages are Jinja2 templates in
app/templates/platform; every value is escaped automatically. Colours match the app's theme (frontend/src/theme)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape

PM_KINDS = {"mock": "Mock PM app", "http": "PM app API", "none": "None"}
TONES = {"active": "ok", "suspended": "bad", "done": "ok", "in_progress": "info", "blocked": "warn", "pending": "warn"}
TASK_STATUSES = ("not_started", "in_progress", "blocked", "done")


def when(v, never: str = "—") -> Markup:
    """A timestamp people can read: 3 Nov 2026, 14:05 UTC (the exact value in the tooltip)."""
    if not v:
        return escape(never)
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v)
        except ValueError:
            return escape(v)
    if v.tzinfo:
        v = v.astimezone(timezone.utc)
    return Markup('<span title="{}">{} UTC</span>').format(v.isoformat(), f"{v:%-d %b %Y, %H:%M}")


def label(status) -> str:
    """not_started → Not started."""
    return str(status or "—").replace("_", " ").capitalize()


env = Environment(loader=FileSystemLoader(Path(__file__).parent / "templates"), autoescape=select_autoescape(["html"]),
                  trim_blocks=True, lstrip_blocks=True)
env.filters.update(when=when, label=label)
env.globals.update(PM_KINDS=PM_KINDS, TONES=TONES, TASK_STATUSES=TASK_STATUSES, today=date.today)


def render(template: str, **context) -> HTMLResponse:
    context.setdefault("admin", None)
    context.setdefault("nav", "")
    return HTMLResponse(env.get_template(f"platform/{template}").render(**context))
