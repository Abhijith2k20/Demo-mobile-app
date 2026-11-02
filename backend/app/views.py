"""How records look to a given viewer. Computed fields (permissions, unread counts, overdue) are
worked out here so the app never has to."""
from __future__ import annotations

from .core import now_ms, parse_iso_ms
from .rules import (
    DELETE_WINDOW_MS,
    EDIT_WINDOW_MS,
    can,
    can_deactivate,
    can_post,
    company_permissions,
    is_company_admin,
    joins_projects,
    project_permissions,
    OPEN_TASK_STATUSES,
    simple_mode,
    task_is_overdue,
)
from .pm import connector as pm
from .store import S, channel_member_ids, project_member, project_member_ids, project_role, setup


def public_user(u: dict, viewer: dict | None = None) -> dict:
    out = {k: u[k] for k in ("id", "name", "email", "companyRole", "avatarColor", "isActive", "online")}
    if viewer is not None:
        out["canDeactivate"] = u["isActive"] and can_deactivate(viewer, u)
        out["joinsProjects"] = joins_projects(u)
    return out


def me_view(user: dict) -> dict:
    mine = [m for m in S().project_members if m["userId"] == user["id"]]
    return {
        "user": public_user(user),
        "permissions": company_permissions(user),
        # The big-button layout, for people whose job titles the company marked as simple.
        "simpleMode": simple_mode(setup(), [m["jobTitle"] for m in mine]),
    }


def project_view(p: dict, viewer: dict) -> dict:
    mine = project_member(viewer["id"], p["id"])
    role = mine["role"] if mine else None
    members = [
        {k: m[k] for k in ("projectId", "userId", "role", "jobTitle")}
        for m in S().project_members
        if m["projectId"] == p["id"]
    ]
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


def _top_level(m: dict) -> bool:
    return not m["threadParentId"] or bool((m["data"] or {}).get("alsoToChannel"))


def order_key(m: dict) -> tuple[str, str]:
    """Messages are ordered by the server's clock. The id (chosen by the phone, so a retry is
    never a duplicate) only breaks ties: it can't move a message or hide it from unread."""
    return (m["createdAt"], m["id"])


def _last_read(viewer: dict, channel_id: str) -> str | None:
    for m in S().channel_members:
        if m["userId"] == viewer["id"] and m["channelId"] == channel_id:
            return m["lastReadMessageId"]
    return None


def channel_stats(viewer: dict) -> dict[str, tuple[int, dict | None]]:
    """Unread count and latest message per channel, for every channel, in one pass over messages."""
    s = S()
    markers: dict[str, tuple[str, str] | None] = {}
    for row in s.channel_members:
        if row["userId"] == viewer["id"]:
            marker = s.messages.get(row["lastReadMessageId"] or "")
            markers[row["channelId"]] = order_key(marker) if marker else None
    stats: dict[str, list] = {}
    for m in s.messages.values():
        if m["deletedAt"] or not _top_level(m):
            continue
        entry = stats.setdefault(m["channelId"], [0, None])
        if entry[1] is None or order_key(m) > order_key(entry[1]):
            entry[1] = m
        marker = markers.get(m["channelId"])
        if not m["threadParentId"] and m["senderId"] != viewer["id"] and (marker is None or order_key(m) > marker):
            entry[0] += 1
    return {cid: (n, last) for cid, (n, last) in stats.items()}


def channel_view(ch: dict, viewer: dict, stats: dict[str, tuple[int, dict | None]] | None = None) -> dict:
    s = S()
    member_ids = channel_member_ids(ch["id"])
    if ch["kind"] == "project" and ch["projectId"]:
        # Owner/Admin can read every project channel but aren't listed as its members.
        on_project = project_member_ids(ch["projectId"])
        listed = [uid for uid in member_ids if uid in on_project]
    else:
        listed = [uid for uid in member_ids if uid != s.bot_id]
    peer_id = next((uid for uid in member_ids if uid != viewer["id"]), None) if ch["kind"] == "dm" else None
    unread, last = (stats if stats is not None else channel_stats(viewer)).get(ch["id"], (0, None))
    marker = s.messages.get(_last_read(viewer, ch["id"]) or "")
    return {
        **ch,
        "memberIds": sorted(listed, key=lambda uid: s.users[uid]["name"] if uid in s.users else uid),
        "peerId": peer_id,
        "joined": viewer["id"] in member_ids,
        "unreadCount": unread,
        "lastReadMessageId": marker["id"] if marker else None,
        # The "new" divider starts after this time (server clock).
        "lastReadAt": marker["createdAt"] if marker else None,
        "lastMessage": message_view(last, viewer, ch) if last else None,
        "canPost": can_post(viewer, ch) and not (ch["projectId"] and s.projects.get(ch["projectId"], {}).get("archivedAt")),
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
        **m,
        "replyCount": count,
        "lastReplyAt": last_at,
        "canEdit": alive and own and m["type"] == "text" and age < EDIT_WINDOW_MS,
        "canDelete": alive and ((own and age < DELETE_WINDOW_MS) or delete_any),
        "canPin": alive and bool(ch["projectId"]) and can(viewer, "message.pin", role),
    }


def reply_info(parents: list[dict]) -> dict[str, tuple[int, str]]:
    ids = {p["id"] for p in parents}
    info: dict[str, tuple[int, str]] = {}
    for m in S().messages.values():
        pid = m["threadParentId"]
        if pid in ids and not m["deletedAt"]:
            count, last = info.get(pid, (0, ""))
            info[pid] = (count + 1, max(last, m["createdAt"]))
    return info


def pm_task_view(t: dict) -> dict:
    """A PM task as the app shows it (read-only): name, finish date, progress, overdue."""
    return {**{k: t[k] for k in ("id", "name", "plannedStart", "plannedFinish", "status", "percent")},
            "isOverdue": task_is_overdue(t)}


def checkin_view(c: dict) -> dict:
    """A check-in with what the card shows: the task as the PM app has it now (None once it's gone),
    its project, whether the answer reached the PM app, and `closed` when there's nothing left to answer
    (the task was finished or removed in the PM app)."""
    task = pm.get_task(c["taskId"])
    project = S().projects.get(c["projectId"] or "")
    return {
        **{k: c[k] for k in ("id", "taskId", "taskName", "projectId", "userId", "askedAt", "answer", "pmWrite", "pmError")},
        "projectName": project["name"] if project else None,
        "task": pm_task_view(task) if task else None,
        "closed": c["answer"] is None and (task is None or task["status"] not in OPEN_TASK_STATUSES),
    }
