"""How records look to a given viewer. Computed fields (permissions, unread counts, overdue) are
worked out here so the app never has to."""
from __future__ import annotations

from . import db
from .core import now_ms, parse_iso_ms
from .rules import (
    DELETE_WINDOW_MS,
    EDIT_WINDOW_MS,
    can,
    can_change_role,
    can_deactivate,
    can_post,
    company_permissions,
    is_company_admin,
    joins_projects,
    project_permissions,
)
from .services import accounts, files
from .store import MESSAGE_COLUMNS, company, project_members


def public_user(u: dict, viewer: dict | None = None) -> dict:
    out = {k: u.get(k) for k in ("id", "name", "email", "companyRole", "avatarColor", "isActive", "online")}
    if viewer is not None:
        out["canDeactivate"] = bool(u["isActive"]) and can_deactivate(viewer, u)
        out["canChangeRole"] = bool(u["isActive"]) and any(can_change_role(viewer, u, r) for r in ("admin", "member", "guest"))
        out["joinsProjects"] = joins_projects(u)
    return out


def me_view(user: dict) -> dict:
    c = company()
    return {
        "user": public_user(user),
        "permissions": company_permissions(user),
        "company": {"id": c["id"], "name": c["name"]},
        "companies": accounts.companies_for(user["id"]),
    }


def project_view(p: dict, viewer: dict) -> dict:
    members = [{k: m[k] for k in ("projectId", "userId")} for m in project_members(p["id"])]
    return {**p, "members": members, "access": {"permissions": project_permissions(viewer, bool(p["archivedAt"]))}}


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


def channel_views(chs: list[dict], viewer: dict) -> list[dict]:
    """Many channels in a fixed number of queries (Home loads every channel the person can read)."""
    ids = [c["id"] for c in chs]
    if not ids:
        return []
    stats = channel_stats(viewer, ids)
    muted = {r["channelId"] for r in db.rows("""SELECT channel_id FROM channel_members
                                                WHERE user_id = %(u)s AND channel_id = ANY(%(ids)s) AND muted""",
                                             u=viewer["id"], ids=ids)}
    members: dict[str, list[str]] = {}
    for r in db.rows("""SELECT cm.channel_id, cm.user_id FROM channel_members cm JOIN users u ON u.id = cm.user_id
                        WHERE cm.channel_id = ANY(%(ids)s) ORDER BY u.name""", ids=ids):
        members.setdefault(r["channelId"], []).append(r["userId"])
    project_ids = list({c["projectId"] for c in chs if c["projectId"]})
    on_project: dict[str, set[str]] = {}
    for r in db.rows("SELECT project_id, user_id FROM project_members WHERE project_id = ANY(%(p)s)", p=project_ids):
        on_project.setdefault(r["projectId"], set()).add(r["userId"])
    archived = {r["id"] for r in db.rows("SELECT id FROM projects WHERE id = ANY(%(p)s) AND archived_at IS NOT NULL",
                                         p=project_ids)}
    replies = reply_info([s[1] for s in stats.values() if s[1]])
    admin = is_company_admin(viewer)
    out = []
    for ch in chs:
        member_ids = members.get(ch["id"], [])
        project_channel = ch["kind"] == "project" and bool(ch["projectId"])
        # Owner/Admin can read every project channel but aren't listed as its members.
        listed = [u for u in member_ids if u in on_project.get(ch["projectId"], set())] if project_channel else member_ids
        unread, last, marker = stats.get(ch["id"], (0, None, None))
        out.append({
            **ch,
            "memberIds": listed,
            "peerId": next((u for u in member_ids if u != viewer["id"]), None) if ch["kind"] == "dm" else None,
            "joined": viewer["id"] in member_ids or (admin and project_channel),
            "unreadCount": unread,
            "muted": ch["id"] in muted,
            "lastReadMessageId": marker["id"] if marker else None,
            # The "new" divider starts after this time (server clock).
            "lastReadAt": marker["at"] if marker else None,
            "lastMessage": message_view(last, viewer, ch, replies) if last else None,
            "canPost": can_post(viewer, ch) and ch["projectId"] not in archived,
        })
    return out


def channel_view(ch: dict, viewer: dict) -> dict:
    return channel_views([ch], viewer)[0]


def message_view(m: dict, viewer: dict, ch: dict, replies: dict[str, tuple[int, str]] | None = None) -> dict:
    own = m["senderId"] == viewer["id"]
    age = now_ms() - parse_iso_ms(m["createdAt"])
    alive = not m["deletedAt"]
    if ch["projectId"]:
        delete_any = can(viewer, "message.delete_any")
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
        "canPin": alive and bool(ch["projectId"]) and can(viewer, "message.pin"),
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
    if (data.get("content") or {}).get("photos"):  # a PM app's channel card with photos from answers
        data["photoUrls"] = [files.signed_url(company_id, u) for u in data["content"]["photos"]]
    return {**m, "data": data}


def reply_info(parents: list[dict]) -> dict[str, tuple[int, str]]:
    ids = [p["id"] for p in parents]
    if not ids:
        return {}
    found = db.rows("""SELECT thread_parent_id AS parent, count(*) AS n, max(created_at) AS last FROM messages
                       WHERE thread_parent_id = ANY(%(ids)s) AND deleted_at IS NULL GROUP BY thread_parent_id""", ids=ids)
    return {r["parent"]: (r["n"], r["last"]) for r in found}
