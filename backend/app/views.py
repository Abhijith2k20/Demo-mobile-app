"""How records look to a given viewer. Computed fields (permissions, unread counts, overdue) are
worked out here so the app never has to."""
from __future__ import annotations

from . import db
from .core import now_ms, parse_iso_ms
from .rules import (
    DELETE_WINDOW_MS,
    EDIT_WINDOW_MS,
    OPEN_TASK_STATUSES,
    can,
    can_change_role,
    can_deactivate,
    can_post,
    company_permissions,
    is_company_admin,
    joins_projects,
    project_permissions,
    simple_mode,
    task_is_overdue,
)
from .pm import connector as pm
from .services import accounts, files
from .store import MESSAGE_COLUMNS, company, person, project, project_member, project_members, project_role, setup


def public_user(u: dict, viewer: dict | None = None) -> dict:
    out = {k: u.get(k) for k in ("id", "name", "email", "phone", "companyRole", "avatarColor", "isActive", "online")}
    if viewer is not None:
        out["canDeactivate"] = bool(u["isActive"]) and can_deactivate(viewer, u)
        out["canChangeRole"] = bool(u["isActive"]) and any(can_change_role(viewer, u, r) for r in ("admin", "member", "guest"))
        out["joinsProjects"] = joins_projects(u)
    return out


def me_view(user: dict) -> dict:
    titles = [r["jobTitle"] for r in db.rows("SELECT job_title FROM project_members WHERE user_id = %(u)s", u=user["id"])]
    c = company()
    return {
        "user": {**public_user(user), "language": user.get("language", "en")},
        "permissions": company_permissions(user),
        # The big-button layout, for people whose job titles the company marked as simple.
        "simpleMode": simple_mode(setup(), titles),
        "company": {"id": c["id"], "name": c["name"],
                    # Linked companies get projects from the PM app; the app hides "New project" then.
                    "pmLinked": bool(db.value("SELECT 1 FROM pm_links WHERE company_id = current_company()"))},
        "companies": accounts.companies_for(user["id"]),
    }


def project_view(p: dict, viewer: dict) -> dict:
    mine = project_member(viewer["id"], p["id"])
    role = mine["role"] if mine else None
    members = [{k: m[k] for k in ("projectId", "userId", "role", "jobTitle", "source")} for m in project_members(p["id"])]
    return {
        **p,
        "linked": bool(p.get("pmProjectId")),  # projects and people come from the PM app
        "members": members,
        "access": {
            "role": role,
            "jobTitle": mine["jobTitle"] if mine else None,
            "permissions": project_permissions(viewer, role, bool(p["archivedAt"])),
        },
    }


def order_key(m: dict) -> tuple[str, str]:
    """Messages are ordered by the server's clock. The id (chosen by the phone, so a retry is
    never a duplicate) only breaks ties: it can't move a message or hide it from unread."""
    return (m["createdAt"], m["id"])


def channel_stats(viewer: dict, channel_ids: list[str]) -> dict[str, tuple[int, dict | None, dict | None]]:
    """Unread count, latest message and the viewer's read marker per channel, in two queries."""
    if not channel_ids:
        return {}
    counts = db.rows("""
        SELECT ch.id AS channel_id, cm.last_read_message_id, lm.created_at AS read_at,
          (SELECT count(*) FROM messages m WHERE m.channel_id = ch.id AND m.deleted_at IS NULL AND m.thread_parent_id IS NULL
             AND m.sender_id <> %(u)s AND (lm.id IS NULL OR (m.created_at, m.id) > (lm.created_at, lm.id))) AS unread,
          (SELECT m.id FROM messages m WHERE m.channel_id = ch.id AND m.deleted_at IS NULL
             AND (m.thread_parent_id IS NULL OR coalesce((m.data->>'alsoToChannel')::boolean, false))
             ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_id
        FROM unnest(%(ids)s::text[]) AS ch(id)
        LEFT JOIN channel_members cm ON cm.channel_id = ch.id AND cm.user_id = %(u)s
        LEFT JOIN messages lm ON lm.id = cm.last_read_message_id""", u=viewer["id"], ids=channel_ids)
    last_ids = [r["lastId"] for r in counts if r["lastId"]]
    lasts = {m["id"]: m for m in db.rows(f"SELECT {MESSAGE_COLUMNS} FROM messages m WHERE id = ANY(%(ids)s)", ids=last_ids)}
    return {r["channelId"]: (r["unread"], lasts.get(r["lastId"]),
                             {"id": r["lastReadMessageId"], "at": r["readAt"]} if r["readAt"] else None) for r in counts}


def channel_view(ch: dict, viewer: dict, stats: dict | None = None) -> dict:
    member_rows = db.rows("""SELECT cm.user_id, u.name FROM channel_members cm JOIN users u ON u.id = cm.user_id
                             WHERE cm.channel_id = %(c)s ORDER BY u.name""", c=ch["id"])
    member_ids = [r["userId"] for r in member_rows]
    if ch["kind"] == "project" and ch["projectId"]:
        # Owner/Admin can read every project channel but aren't listed as its members.
        on_project = {m["userId"] for m in project_members(ch["projectId"])}
        listed = [uid for uid in member_ids if uid in on_project]
    else:
        listed = member_ids
    peer_id = next((uid for uid in member_ids if uid != viewer["id"]), None) if ch["kind"] == "dm" else None
    unread, last, marker = (stats if stats is not None else channel_stats(viewer, [ch["id"]])).get(ch["id"], (0, None, None))
    archived = bool(ch["projectId"]) and bool((project(ch["projectId"]) or {}).get("archivedAt"))
    return {
        **ch,
        "memberIds": listed,
        "peerId": peer_id,
        "joined": viewer["id"] in member_ids,
        "unreadCount": unread,
        "lastReadMessageId": marker["id"] if marker else None,
        # The "new" divider starts after this time (server clock).
        "lastReadAt": marker["at"] if marker else None,
        "lastMessage": message_view(last, viewer, ch) if last else None,
        "canPost": can_post(viewer, ch) and not archived,
    }


def message_view(m: dict, viewer: dict, ch: dict, replies: dict[str, tuple[int, str]] | None = None) -> dict:
    role = project_role(viewer["id"], ch["projectId"]) if ch["projectId"] else None
    own = m["senderId"] == viewer["id"]
    age = now_ms() - parse_iso_ms(m["createdAt"])
    alive = not m["deletedAt"]
    if ch["projectId"]:
        delete_any = can(viewer, "message.delete_any", role)
    else:
        delete_any = is_company_admin(viewer) and ch["kind"] == "company"
    if replies is None:
        replies = reply_info([m])
    count, last_at = replies.get(m["id"], (0, None))
    return {
        **with_links({k: v for k, v in m.items() if k != "companyId"}),
        "replyCount": count,
        "lastReplyAt": last_at,
        "canEdit": alive and own and m["type"] == "text" and age < EDIT_WINDOW_MS,
        "canDelete": alive and ((own and age < DELETE_WINDOW_MS) or delete_any),
        "canPin": alive and bool(ch["projectId"]) and can(viewer, "message.pin", role),
    }


def with_links(m: dict) -> dict:
    """Signed links for the message's photos, voice note or file; only made for a viewer who can see it."""
    data = m.get("data")
    if not data:
        return m
    data, company_id = dict(data), db.company_id()
    if data.get("attachments"):
        data["attachments"] = [{**a, "uri": files.signed_url(company_id, a["uploadId"]) if a.get("uploadId") else None}
                               for a in data["attachments"]]
    if data.get("uploadId"):
        data["uri"] = files.signed_url(company_id, data["uploadId"])
    return {**m, "data": data}


def reply_info(parents: list[dict]) -> dict[str, tuple[int, str]]:
    ids = [p["id"] for p in parents]
    if not ids:
        return {}
    found = db.rows("""SELECT thread_parent_id AS parent, count(*) AS n, max(created_at) AS last FROM messages
                       WHERE thread_parent_id = ANY(%(ids)s) AND deleted_at IS NULL GROUP BY thread_parent_id""", ids=ids)
    return {r["parent"]: (r["n"], r["last"]) for r in found}


def pm_task_view(t: dict) -> dict:
    """A PM task as the app shows it (read-only): name, finish date, progress, overdue."""
    return {**{k: t[k] for k in ("id", "name", "plannedStart", "plannedFinish", "status", "percent")},
            "isOverdue": task_is_overdue(t)}


def checkin_view(c: dict) -> dict:
    """A check-in with what the card shows: the task as Siteline last saw it in the PM app (None once
    it's gone), its project, whether the answer reached the PM app, and `closed` when there's nothing left
    to answer (the task was finished, removed or given to someone else in the PM app)."""
    task = pm.saved_task(c["taskId"])
    p = project(c["projectId"])
    return {
        **{k: c[k] for k in ("id", "taskId", "taskName", "projectId", "userId", "askedAt", "answer", "pmWrite", "pmError")},
        "projectName": p["name"] if p else None,
        "task": pm_task_view(task) if task else None,
        "closed": c["answer"] is None and (task is None or task["status"] not in OPEN_TASK_STATUSES
                                           or task["ownerUserId"] != c["userId"]),
    }


def person_view(user_id: str, viewer: dict) -> dict | None:
    u = person(user_id)
    return public_user(u, viewer) if u else None
