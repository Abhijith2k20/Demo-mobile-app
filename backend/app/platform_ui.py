"""Look of the platform panel (server-rendered pages for the Siteline team). Colours match the app's theme
(frontend/src/theme/colors.ts) and follow the system's light or dark appearance. No JavaScript except
confirm-before-destructive and copy buttons."""
from __future__ import annotations

import html
from datetime import datetime, timezone

from fastapi.responses import HTMLResponse

CSS = """
:root{--bg:#F4F5F6;--surface:#FFFFFF;--alt:#F4F5F6;--border:#E2E4E7;--field:#C9CCD1;--text:#1D1C1D;--muted:#616061;
--accent:#1667B0;--accentSoft:#E8F1F9;--onAccent:#FFFFFF;--success:#2A7253;--successSoft:#E6F2EC;--warning:#87600F;
--warningSoft:#FBF2DE;--danger:#B8423A;--dangerSoft:#FBEAE8;--header:#1B2430;--onHeader:#FFFFFF;--shadow:0 1px 2px rgba(0,0,0,.05)}
@media (prefers-color-scheme:dark){:root{--bg:#1A1D21;--surface:#222529;--alt:#2C2F33;--border:#35373B;--field:#46494E;
--text:#D1D2D3;--muted:#A3A5A8;--accent:#4A9FE0;--accentSoft:#1B2E40;--onAccent:#0E1A26;--success:#5FB58C;--successSoft:#1B2F26;
--warning:#D6A64F;--warningSoft:#332A17;--danger:#E0736A;--dangerSoft:#38201E;--header:#121417;--onHeader:#F2F3F4;--shadow:none}}
*{box-sizing:border-box}
html{color-scheme:light dark}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;
-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.top{background:var(--header);color:var(--onHeader)}
.top .wrap{display:flex;align-items:center;gap:28px;height:56px}
.brand{display:flex;align-items:center;gap:10px;color:var(--onHeader);font-weight:600;font-size:15px}
.brand:hover{text-decoration:none}
.logo{width:28px;height:28px;border-radius:7px;background:var(--accent);color:var(--onAccent);display:grid;place-items:center;font-weight:700}
.brand small{font-weight:500;opacity:.6}
.top nav{display:flex;gap:4px;flex:1}
.top nav a{color:var(--onHeader);opacity:.7;padding:6px 12px;border-radius:8px;font-weight:500}
.top nav a:hover{opacity:1;text-decoration:none;background:rgba(255,255,255,.08)}
.top nav a.on{opacity:1;background:rgba(255,255,255,.12)}
.who{font-size:13px;opacity:.7}
main{padding:32px 0 64px}
.crumbs{font-size:13px;color:var(--muted);margin-bottom:6px}
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap}
h1{font-size:26px;line-height:1.2;margin:0;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:12px}
.sub{color:var(--muted);margin:6px 0 0}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);margin-bottom:20px;overflow:hidden}
.card>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border)}
.card>header h2{font-size:16px;margin:0;font-weight:600}
.card>header p{margin:2px 0 0;color:var(--muted);font-size:13px}
.body{padding:20px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media (max-width:820px){.grid2{grid-template-columns:1fr}.top .wrap{gap:12px}.who{display:none}}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th{font-size:12px;font-weight:600;color:var(--muted);text-align:left;padding:10px 20px;background:var(--alt);border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:12px 20px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:color-mix(in srgb,var(--alt) 55%,transparent)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.dense td,.dense th{padding:8px 10px} .dense td:first-child,.dense th:first-child{padding-left:20px}
.strong{font-weight:600;color:var(--text)}
.muted{color:var(--muted)} .small{font-size:12.5px}
.mono{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.trunc{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;
background:var(--alt);color:var(--muted);white-space:nowrap;letter-spacing:0}
.pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.pill.ok{background:var(--successSoft);color:var(--success)} .pill.bad{background:var(--dangerSoft);color:var(--danger)}
.pill.warn{background:var(--warningSoft);color:var(--warning)} .pill.info{background:var(--accentSoft);color:var(--accent)}
.flash{display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border-radius:10px;margin-bottom:20px;font-weight:500}
.flash.ok{background:var(--successSoft);color:var(--success)} .flash.bad{background:var(--dangerSoft);color:var(--danger)}
.flash.warn{background:var(--warningSoft);color:var(--warning)}
.empty{padding:28px 20px;text-align:center;color:var(--muted)}
.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.fields .wide{grid-column:1/-1}
@media (max-width:640px){.fields{grid-template-columns:1fr}}
label.f{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600}
label.f span{font-weight:400;color:var(--muted);font-size:12.5px}
input,select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--field);border-radius:8px;height:36px;padding:0 10px;width:100%}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accentSoft)}
input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:var(--accent)}
.check{display:flex;gap:10px;align-items:center;font-size:13.5px}
.sm{height:30px;padding:0 8px;font-size:13px}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:20px}
.btn{font:inherit;font-weight:600;font-size:13.5px;height:36px;padding:0 16px;border-radius:8px;border:1px solid transparent;cursor:pointer;
background:var(--accent);color:var(--onAccent);display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.btn:hover{filter:brightness(1.07);text-decoration:none}
.btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accentSoft)}
.btn.secondary{background:var(--surface);color:var(--text);border-color:var(--field)}
.btn.secondary:hover{background:var(--alt);filter:none}
.btn.danger{background:var(--surface);color:var(--danger);border-color:var(--field)}
.btn.danger:hover{background:var(--dangerSoft);filter:none}
.btn.link{background:none;border:0;color:var(--accent);padding:0 4px;height:auto}
.btn.link.danger{color:var(--danger)}
.btn.small{height:30px;padding:0 12px;font-size:13px}
.btn.full{width:100%;justify-content:center}
form.inline{display:inline}
details.card>summary{list-style:none;cursor:pointer;padding:16px 20px;display:flex;align-items:center;gap:10px;font-weight:600}
details.card>summary::-webkit-details-marker{display:none}
details.card>summary::before{content:"+";width:22px;height:22px;border-radius:6px;background:var(--accentSoft);color:var(--accent);
display:grid;place-items:center;font-weight:700}
details.card[open]>summary{border-bottom:1px solid var(--border)} details.card[open]>summary::before{content:"\\2212"}
.auth{min-height:100vh;display:grid;place-items:center;padding:24px}
.auth .card{width:100%;max-width:400px;margin:0}
.auth .body{padding:32px}
.auth h1{font-size:22px;margin-bottom:6px}
.auth .logo{width:40px;height:40px;border-radius:10px;font-size:18px;margin-bottom:20px}
.code{font-size:22px;letter-spacing:.4em;text-align:center;height:48px;font-variant-numeric:tabular-nums}
.secret{display:flex;gap:8px} .secret input{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:0;font-size:13.5px}
.kv dt{color:var(--muted)} .kv dd{margin:0}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:16px 20px;border-bottom:1px solid var(--border)}
.chip{display:inline-flex;align-items:center;gap:10px;padding:4px 6px 4px 12px;border:1px solid var(--border);border-radius:999px;font-size:13px}
"""

PM_KINDS = {"mock": "Mock PM app", "http": "PM app API", "none": "None"}
_TONES = {"active": "ok", "suspended": "bad", "deactivated": "", "closed": "", "done": "ok", "in_progress": "info",
          "blocked": "warn", "not_started": "", "pending": "warn"}


def e(v) -> str:
    return html.escape("" if v is None else str(v))


def when(v, never: str = "—") -> str:
    """A timestamp people can read: 3 Nov 2026, 14:05 UTC."""
    if not v:
        return never
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v)
        except ValueError:
            return e(v)
    if v.tzinfo:
        v = v.astimezone(timezone.utc)
    return f'<span title="{e(v.isoformat())}">{v:%-d %b %Y, %H:%M} UTC</span>'


def pill(status, label: str | None = None) -> str:
    text = label or str(status or "—").replace("_", " ").capitalize()
    return f'<span class="pill {_TONES.get(str(status), "")}">{e(text)}</span>'


def flash(text: str, tone: str = "ok") -> str:
    return f'<div class="flash {tone}" role="status">{e(text)}</div>' if text else ""


def empty(text: str, cols: int) -> str:
    return f'<tr><td colspan="{cols}" class="empty">{e(text)}</td></tr>'


def card(title: str, body: str, hint: str = "", right: str = "") -> str:
    sub = f"<p>{hint}</p>" if hint else ""
    return f'<section class="card"><header><div><h2>{e(title)}</h2>{sub}</div>{right}</header>{body}</section>'


def confirm(message: str) -> str:
    """onsubmit handler: destructive actions ask first."""
    return f'onsubmit="return confirm({e(repr(message))})"'


def page(title: str, body: str, admin: str | None = None, nav: str = "") -> HTMLResponse:
    if admin is None:  # sign-in pages: one centred card, no navigation
        chrome = f'<main class="auth">{body}</main>'
    else:
        links = "".join(f'<a href="{href}" class="{"on" if key == nav else ""}">{label}</a>'
                        for key, href, label in (("companies", "/platform", "Companies"), ("audit", "/platform/audit", "Audit log")))
        chrome = f"""<header class="top"><div class="wrap"><a class="brand" href="/platform"><span class="logo">S</span>Siteline
<small>Platform</small></a><nav>{links}</nav><span class="who">{e(admin)}</span></div></header>
<main><div class="wrap">{body}</div></main>"""
    return HTMLResponse(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)} · Siteline Platform</title>
<style>{CSS}</style></head><body>{chrome}</body></html>""")


def auth_card(title: str, intro: str, form: str, error: str = "") -> str:
    return f"""<div class="card"><div class="body"><div class="logo">S</div><h1>{e(title)}</h1>
<p class="sub" style="margin-bottom:24px">{intro}</p>{flash(error, "bad")}{form}</div></div>"""
