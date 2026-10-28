"""All demo data (§11). Dates are relative to "now" so the demo always looks current."""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta

from .core import avatar_tone, iso_ms
from .rules import default_channel_names
from .store import Store

_seq = 0

# Paliath is an interior-design studio, so its workspace speaks that language. Another company
# gets its own stages, phases, job titles and channels; the code doesn't change.
PALIATH_SETUP = {
    "stages": [
        {"key": "design", "label": {"en": "Design", "kn": "ಡಿಸೈನ್", "hi": "डिज़ाइन"}},
        {"key": "approval", "label": {"en": "Approval", "kn": "ಅನುಮೋದನೆ", "hi": "मंज़ूरी"}},
        {"key": "procurement", "label": {"en": "Procurement", "kn": "ಖರೀದಿ", "hi": "ख़रीद"}},
        {"key": "execution", "label": {"en": "Execution", "kn": "ಕೆಲಸ", "hi": "काम"}},
        {"key": "finishing", "label": {"en": "Finishing", "kn": "ಫಿನಿಶಿಂಗ್", "hi": "फ़िनिशिंग"}},
        {"key": "handover", "label": {"en": "Handover", "kn": "ಹಸ್ತಾಂತರ", "hi": "हैंडओवर"}},
    ],
    "phases": ["Civil", "Electrical", "Plumbing", "False ceiling", "Carpentry", "Painting", "Finishing", "Handover"],
    "projectChannels": [
        {"name": "general"}, {"name": "design"}, {"name": "site-work"}, {"name": "qs", "private": True},
    ],
    # Task cards and the bot's escalations go here when a task has no channel of its own.
    "workChannel": "site-work",
    "jobTitles": [
        {"name": "Project Manager", "label": {"en": "Project Manager", "kn": "ಪ್ರಾಜೆಕ್ಟ್ ಮ್ಯಾನೇಜರ್", "hi": "प्रोजेक्ट मैनेजर"},
         "managersOnly": True, "channels": ["general", "design", "site-work"]},
        {"name": "Designer", "label": {"en": "Designer", "kn": "ಡಿಸೈನರ್", "hi": "डिज़ाइनर"}, "channels": ["design", "general"]},
        {"name": "QS", "label": {"en": "QS", "kn": "QS", "hi": "QS"}, "channels": ["qs", "general"]},
        {"name": "Supervisor", "label": {"en": "Supervisor", "kn": "ಸೂಪರ್‌ವೈಸರ್", "hi": "सुपरवाइज़र"},
         "channels": ["site-work", "general"]},
        {"name": "Worker", "label": {"en": "Worker", "kn": "ಕೆಲಸಗಾರ", "hi": "कामगार"}, "channels": ["site-work", "general"],
         "simpleMode": True},
    ],
    "defaultJobTitle": "Worker",
    # Quick picks for "Report issue" and the bot's "Problem" answer; "Other" is always added by the app.
    "problemTypes": [
        {"key": "Material not arrived", "label": {"en": "Material not arrived", "kn": "ಸಾಮಗ್ರಿ ಬಂದಿಲ್ಲ", "hi": "सामान नहीं आया"}},
        {"key": "Waiting for design", "label": {"en": "Waiting for design", "kn": "ಡಿಸೈನ್\u200cಗಾಗಿ ಕಾಯುತ್ತಿದ್ದೇವೆ",
                                                "hi": "डिज़ाइन का इंतज़ार"}},
        {"key": "Labour short", "label": {"en": "Labour short", "kn": "ಕೆಲಸಗಾರರು ಕಡಿಮೆ", "hi": "मज़दूर कम हैं"}},
        {"key": "Damage", "label": {"en": "Damage", "kn": "ಹಾನಿ", "hi": "नुकसान"}, "inCheckins": False},
    ],
}


def uuid_at(ms: float) -> str:
    """UUIDv7-shaped id for a given time, ordered by time then by creation order."""
    global _seq
    t = f"{int(ms):012x}"
    s = f"{_seq:011x}"
    _seq += 1
    return f"{t[:8]}-{t[8:12]}-7{s[:3]}-8{s[3:6]}-0000000{s[6:11]}"


def build() -> Store:
    global _seq
    _seq = 0
    now = int(time.time() * 1000)
    midnight = datetime.combine(date.today(), datetime.min.time()).astimezone()
    today = int(midnight.timestamp() * 1000)
    DAY = 86_400_000
    epoch = now - 60 * DAY

    def iso(ms: float) -> str:
        return iso_ms(int(ms))

    def day(offset: int) -> str:
        return (date.today() + timedelta(days=offset)).isoformat()

    def at(d: int, hh: int, mm: int) -> int:
        """A time `d` days ago at hh:mm; never in the future."""
        return min(today - d * DAY + hh * 3_600_000 + mm * 60_000, now - 60_000)

    def ago(mins: float) -> int:
        return int(now - mins * 60_000)

    company_id = uuid_at(epoch)
    s = Store(company_id=company_id, company={"id": company_id, "name": "Paliath Interiors", "setup": PALIATH_SETUP})

    # ---- Users ----
    U: dict[str, str] = {}

    def add_user(key: str, name: str, email: str, role: str, online: bool = False) -> None:
        uid = uuid_at(epoch)
        U[key] = uid
        s.users[uid] = {"id": uid, "name": name, "email": email, "companyRole": role, "avatarColor": avatar_tone(uid),
                        "isActive": True, "updatedAt": iso(epoch), "online": online}

    add_user("arjun", "Arjun Rao", "arjun@paliath.in", "owner", True)
    add_user("meera", "Meera Iyer", "meera@paliath.in", "admin", True)
    add_user("amit", "Amit Kulkarni", "amit@paliath.in", "member", True)
    add_user("kavya", "Kavya Shetty", "kavya@paliath.in", "member", True)
    add_user("rohan", "Rohan Desai", "rohan@paliath.in", "member")
    add_user("suresh", "Suresh Gowda", "suresh@paliath.in", "member", True)
    add_user("ravi", "Ravi Kumar", "ravi@paliath.in", "member")
    add_user("manju", "Manjunath", "manjunath@paliath.in", "member")
    add_user("imran", "Imran Pasha", "imran@paliath.in", "member", True)
    add_user("lakshmi", "Lakshmi Devi", "lakshmi@paliath.in", "member")
    add_user("prakash", "Prakash Naik", "prakash@paliath.in", "member")
    add_user("bot", "Siteline Bot", "bot@siteline.app", "member", True)
    s.bot_id = U["bot"]
    admin_keys = ["arjun", "meera"]
    human_keys = [k for k in U if k != "bot"]

    # ---- Channels ----
    def add_channel(name: str, kind: str, project_id: str | None, members: list[str], **opts) -> str:
        cid = uuid_at(epoch)
        s.channels[cid] = {"id": cid, "companyId": company_id, "projectId": project_id, "name": name, "kind": kind,
                           "isPrivate": False, "postingPolicy": "everyone", "updatedAt": iso(epoch), **opts}
        for k in members:
            s.channel_members.append({"channelId": cid, "userId": U[k], "lastReadMessageId": None, "joinedAt": iso(epoch)})
        return cid

    # ---- Projects ----
    def add_project(name: str, client: str, address: str, stage: str, start: int, members: list[tuple[str, str, str]]) -> dict:
        pid = uuid_at(epoch)
        project = {"id": pid, "companyId": company_id, "name": name, "client": client, "address": address, "stage": stage,
                   "startDate": day(start), "plannedFinish": day(start), "baselineFinish": None, "baselineLocked": False,
                   "archivedAt": None, "updatedAt": iso(epoch)}
        s.projects[pid] = project
        for k, role, jt in members:
            s.project_members.append({"projectId": pid, "userId": U[k], "role": role, "jobTitle": jt, "joinedAt": iso(epoch)})
        ch = {}
        for std in PALIATH_SETUP["projectChannels"]:
            cname = std["name"]
            joined = [k for k, role, jt in members if cname in default_channel_names(PALIATH_SETUP, role, jt)]
            ch[cname] = add_channel(cname, "project", pid, list(dict.fromkeys([*joined, *admin_keys])),
                                    isPrivate=std.get("private", False))
        return {"id": pid, "project": project, "ch": ch}

    sharma = add_project("Villa 99", "Villa 99 owners", "Bengaluru", "execution", -45, [
        ("amit", "manager", "Project Manager"), ("kavya", "member", "Designer"), ("rohan", "member", "QS"),
        ("suresh", "manager", "Supervisor"), ("ravi", "member", "Worker"), ("manju", "member", "Worker"),
        ("imran", "member", "Worker"),
    ])
    mehta = add_project("RV University", "RV University", "Bengaluru", "design", -12, [
        ("kavya", "manager", "Project Manager"), ("rohan", "member", "QS"),
    ])
    cafe = add_project("OITH", "OITH", "Bengaluru", "finishing", -50, [
        ("amit", "manager", "Project Manager"), ("suresh", "member", "Supervisor"), ("imran", "member", "Worker"),
        ("lakshmi", "member", "Worker"), ("prakash", "member", "Worker"),
    ])

    announcements = add_channel("announcements", "company", None, human_keys, postingPolicy="admins")
    company_general = add_channel("general", "company", None, human_keys)
    dm_amit_ravi = add_channel("", "dm", None, ["amit", "ravi"], isPrivate=True)
    dm_amit_suresh = add_channel("", "dm", None, ["amit", "suresh"], isPrivate=True)
    dm_arjun_amit = add_channel("", "dm", None, ["arjun", "amit"], isPrivate=True)
    bot_dm = {k: add_channel("Siteline Bot", "bot", None, [k], isPrivate=True) for k in human_keys}

    # ---- Tasks ----
    T: dict[str, str] = {}

    def add_tasks(p: dict, specs: list[tuple], baseline_locked: bool) -> None:
        max_planned = p["project"]["startDate"]
        max_baseline = ""
        for spec in specs:
            phase, name, start, finish, status, percent, owner = spec[:7]
            slip = spec[7] if len(spec) > 7 else 0
            tid = uuid_at(epoch)
            T[name] = tid
            task = {
                "id": tid, "projectId": p["id"], "phase": phase, "name": name, "description": None,
                "ownerId": U[owner] if owner else None, "plannedStart": day(start), "plannedFinish": day(finish),
                "baselineStart": day(start - slip) if baseline_locked else None,
                "baselineFinish": day(finish - slip) if baseline_locked else None,
                "actualStart": None if status == "not_started" else day(start),
                "actualFinish": day(finish) if status == "done" else None,
                "status": status, "percent": percent,
                "channelId": p["ch"]["design"] if phase == "Design" else p["ch"]["site-work"],
                "updatedAt": iso(epoch), "deletedAt": None,
            }
            s.tasks[tid] = task
            max_planned = max(max_planned, task["plannedFinish"])
            if task["baselineFinish"]:
                max_baseline = max(max_baseline, task["baselineFinish"])
        p["project"].update(plannedFinish=max_planned, baselineLocked=baseline_locked,
                            baselineFinish=max_baseline if baseline_locked else None)

    add_tasks(sharma, [
        ("Civil", "Demolition & debris clearing", -44, -41, "done", 100, "suresh"),
        ("Civil", "Wall chasing for conduits", -41, -38, "done", 100, "manju"),
        ("Civil", "Masonry partition – kitchen", -38, -34, "done", 100, "manju"),
        ("Civil", "Floor levelling", -34, -31, "done", 100, "suresh"),
        ("Electrical", "Conduit laying", -31, -28, "done", 100, "suresh"),
        ("Electrical", "Wiring – bedrooms", -28, -25, "done", 100, "suresh"),
        ("Electrical", "Wiring – living & kitchen", -25, -22, "done", 100, "suresh"),
        ("Electrical", "DB & switch boxes", -22, -20, "done", 100, "suresh"),
        ("Plumbing", "Kitchen plumbing lines", -30, -27, "done", 100, "manju"),
        ("Plumbing", "Bathroom plumbing – master", -27, -24, "done", 100, "manju"),
        ("Plumbing", "Pressure test", -24, -23, "done", 100, "suresh"),
        ("False ceiling", "Framing grid – living room", -10, -7, "done", 100, "ravi"),
        ("False ceiling", "False ceiling – living room", -7, 2, "in_progress", 50, "ravi", 4),
        ("False ceiling", "False ceiling – master bedroom", -5, 3, "blocked", 10, "ravi", 4),
        ("False ceiling", "False ceiling – kids bedroom", 3, 6, "not_started", 0, "ravi", 4),
        ("False ceiling", "Cove lighting channels", 5, 7, "not_started", 0, "manju", 4),
        ("Carpentry", "Kitchen carcass", -3, 6, "in_progress", 25, "imran", 4),
        ("Carpentry", "Wardrobe – master bedroom", 1, 9, "not_started", 0, "imran", 4),
        ("Carpentry", "Wardrobe – kids bedroom", 6, 12, "not_started", 0, "imran", 4),
        ("Carpentry", "TV unit – living room", 9, 14, "not_started", 0, "imran", 4),
        ("Carpentry", "Shoe rack & foyer panel", 12, 15, "not_started", 0, None, 4),
        ("Carpentry", "Study table", 14, 17, "not_started", 0, None, 4),
        ("Painting", "Putty & primer", 8, 12, "not_started", 0, None, 4),
        ("Painting", "First coat", 12, 15, "not_started", 0, None, 4),
        ("Painting", "Texture wall – living room", 15, 17, "not_started", 0, None, 4),
        ("Painting", "Final coat", 18, 21, "not_started", 0, None, 4),
        ("Finishing", "Hardware & handles", 17, 19, "not_started", 0, "imran", 4),
        ("Finishing", "Light fixtures", 19, 21, "not_started", 0, "suresh", 4),
        ("Finishing", "Soft furnishings", 21, 23, "not_started", 0, "kavya", 4),
        ("Finishing", "Deep cleaning", 23, 24, "not_started", 0, "suresh", 4),
        ("Handover", "Snag list walkthrough", 24, 25, "not_started", 0, "amit", 4),
        ("Handover", "Client handover", 26, 26, "not_started", 0, "arjun", 4),
    ], True)
    add_tasks(mehta, [
        ("Design", "Site measurement", -12, -11, "done", 100, "kavya"),
        ("Design", "Client brief & moodboard", -11, -8, "done", 100, "kavya"),
        ("Design", "Concept layout options", -8, -5, "done", 100, "kavya"),
        ("Design", "Concept presentation", -4, -3, "done", 100, "kavya"),
        ("Design", "3D renders – lobby & cafeteria", -2, 3, "in_progress", 50, "kavya"),
        ("Design", "3D renders – classrooms", 3, 7, "not_started", 0, "kavya"),
        ("Design", "Material board", -1, 5, "in_progress", 25, "kavya"),
        ("Design", "Lighting plan", 5, 8, "not_started", 0, "kavya"),
        ("Design", "Cafeteria detailed drawings", 7, 11, "not_started", 0, "kavya"),
        ("Design", "BOQ & estimate", 8, 12, "not_started", 0, "rohan"),
        ("Design", "Client approval – design", 12, 14, "not_started", 0, "arjun"),
        ("Design", "Sign-off & advance", 14, 15, "not_started", 0, "meera"),
    ], False)
    add_tasks(cafe, [
        ("Civil", "Site clearing & marking", -50, -47, "done", 100, "suresh"),
        ("Civil", "Counter masonry base", -47, -42, "done", 100, "prakash"),
        ("Electrical", "Conduits & wiring", -42, -36, "done", 100, "suresh"),
        ("Electrical", "Kitchen power points", -36, -33, "done", 100, "suresh"),
        ("Plumbing", "Bar sink & drain lines", -40, -36, "done", 100, "prakash"),
        ("Plumbing", "Washroom plumbing", -36, -32, "done", 100, "prakash"),
        ("False ceiling", "Exposed ceiling paint", -32, -29, "done", 100, "lakshmi"),
        ("False ceiling", "Acoustic baffles", -29, -25, "done", 100, "imran"),
        ("Carpentry", "Bar counter cladding", -25, -18, "done", 100, "imran"),
        ("Carpentry", "Banquette seating", -18, -12, "done", 100, "imran"),
        ("Carpentry", "Display shelves", -12, -8, "done", 100, "imran"),
        ("Painting", "Wall putty & primer", -14, -10, "done", 100, "lakshmi"),
        ("Painting", "Feature wall mural base", -10, -7, "done", 100, "lakshmi"),
        ("Painting", "Final coat – seating area", -6, -3, "done", 100, "lakshmi", -1),
        ("Finishing", "Counter stone & polish", -6, -2, "done", 100, "prakash", -1),
        ("Finishing", "Pendant lights", -1, 2, "in_progress", 50, "suresh", -1),
        ("Finishing", "Signage & branding", 1, 4, "not_started", 0, "imran", -1),
        ("Handover", "Snag list & handover", 4, 6, "not_started", 0, "amit", -1),
    ], True)

    # ---- Messages ----
    def img(tone: str, caption: str) -> dict:
        return {"id": uuid_at(epoch), "kind": "image", "uri": None, "uploadId": None, "caption": caption, "tone": tone}

    def say(channel_id: str, ms: int, sender: str, body: str | None, *, type: str = "text", data: dict | None = None,
            parent: str | None = None, reactions: dict | None = None, deleted: bool = False) -> str:
        mid = uuid_at(ms)
        s.messages[mid] = {
            "id": mid, "channelId": channel_id, "senderId": U[sender], "type": type,
            "body": None if deleted else body, "data": None if deleted else data, "threadParentId": parent,
            "reactions": {e: [U[k] for k in keys] for e, keys in (reactions or {}).items()},
            "status": "sent", "createdAt": iso(ms), "updatedAt": iso(ms),
            "deletedAt": iso(ms + 120_000) if deleted else None,
        }
        return mid

    def photos(*a: dict) -> dict:
        return {"type": "image", "data": {"attachments": list(a)}}

    def file(name: str, size_kb: int) -> dict:
        return {"type": "file", "data": {"name": name, "sizeKb": size_kb}}

    def status(user: str, task_name: str, answer: dict, has_photo: bool = False) -> dict:
        return {"type": "status_card", "data": {"kind": "checkin", "userId": U[user], "taskId": T[task_name],
                                                "taskName": task_name, "answer": answer, "hasPhoto": has_photo}}

    # Villa 99 — #site-work
    sw = sharma["ch"]["site-work"]
    say(sw, at(9, 9, 10), "suresh", "Good morning team. Electrical and plumbing are closed out. False ceiling starts today in the living room.")
    say(sw, at(9, 9, 25), "amit", "Thanks Suresh. Ravi, Manjunath — please start with the framing grid. Drawings are in #design.")
    say(sw, at(9, 9, 40), "ravi", "Ok sir. Starting grid marking now.")
    say(sw, at(9, 13, 5), "ravi", "Level marking done", **photos(img("stone", "Ceiling level marking")))
    say(sw, at(9, 17, 45), "suresh", "Site closed. 5 workers today. Grid marking complete in living room.")
    say(sw, at(8, 9, 15), "manju", "GI channels unloaded. 60 lengths.")
    say(sw, at(8, 11, 30), "suresh", "Plywood delivered — 18mm BWP, 40 sheets", **photos(img("sand", "Plywood stack – 40 sheets")))
    say(sw, at(8, 11, 42), "amit", "Good. Keep it off the floor please, on battens.", reactions={"👍": ["suresh", "ravi"]})
    say(sw, at(8, 16, 20), "ravi", "Framing grid 60% done in living room")
    say(sw, at(7, 10, 0), "suresh", "False ceiling grid done in living room, gypsum boards tomorrow",
        **photos(img("stone", "Living room grid"), img("linen", "Grid – window side")))
    say(sw, at(7, 10, 12), "amit", "Nice work 👏", reactions={"🙏": ["ravi"]})
    say(sw, at(7, 15, 30), "imran", "Carpentry team will reach site Thursday. Need the kitchen wall cleared.")
    say(sw, at(7, 15, 44), "suresh", "Will clear by Wednesday evening.")
    thread = say(sw, at(6, 9, 5), "suresh", "Gypsum boards for master bedroom not delivered. Vendor says the truck is stuck at Hosur.")
    say(sw, at(6, 9, 12), "amit", "How many boards short?", parent=thread)
    say(sw, at(6, 9, 15), "suresh", "24 boards. Living room stock is enough for now.", parent=thread)
    say(sw, at(6, 9, 40), "amit", "Called the vendor — promised tomorrow before noon.", parent=thread)
    say(sw, at(6, 9, 48), "ravi", "Ok sir, we will continue living room till then.", parent=thread)
    say(sw, at(6, 9, 30), "suresh", None, type="issue_card", data={
        "what": "Material not arrived", "note": "Gypsum boards for master bedroom, 24 nos.", "urgency": "urgent",
        "taskId": T["False ceiling – master bedroom"], "taskName": "False ceiling – master bedroom",
        "attachments": [img("stone", "Master bedroom – empty bay")], "mentions": [U["amit"]],
    })
    say(sw, at(6, 18, 4), "bot", None, **status("ravi", "False ceiling – living room", {"kind": "progress", "percent": 25}))
    say(sw, at(6, 18, 20), "suresh", None, type="daily_report", data={
        "workDone": "Living room boarding started, 8 boards fixed. Kitchen wall cleared for carpentry.", "workers": 6,
        "problems": "Master bedroom boards not delivered.", "tomorrow": "Continue living room boarding. Receive gypsum boards.",
        "attachments": [img("linen", "Boarding – living room"), img("stone", "Kitchen wall cleared")],
    })
    say(sw, at(5, 9, 20), "ravi", None, type="voice", data={"durationSec": 14})
    say(sw, at(5, 11, 0), "amit", None, type="task_card", data={"taskId": T["Kitchen carcass"]})
    say(sw, at(5, 14, 15), "suresh", "Living room boarding progress",
        **photos(img("linen", "Boarding – centre"), img("stone", "Boarding – cove edge"), img("sage", "Window side")))
    say(sw, at(4, 9, 10), "amit", "Client visit on Saturday 11 am. Please keep the living room clean and the sample laminate ready.")
    say(sw, at(4, 9, 18), "suresh", "Noted.")
    say(sw, at(4, 16, 40), "manju", "Kitchen wall cleared for carpentry.")
    say(sw, at(4, 16, 41), "manju", "wrong photo", deleted=True)
    say(sw, at(3, 10, 5), "imran", "Carcass cutting started. 18mm BWP for base units.", **photos(img("sand", "Carcass panels cut")))
    say(sw, at(3, 10, 30), "amit", "Imran, please check drawing rev C — the TV unit is 6 inches wider now.", data={"edited": True})
    say(sw, at(3, 10, 36), "imran", "Seen. Will follow rev C.")
    say(sw, at(3, 18, 2), "bot", None, **status("ravi", "False ceiling – living room", {"kind": "progress", "percent": 50}, True))
    say(sw, at(2, 9, 30), "suresh", "Electrician coming at 3 pm for cove light points. Ravi, keep the channel open on the window side.")
    say(sw, at(2, 9, 41), "ravi", "Ok sir")
    say(sw, at(2, 15, 10), "amit", "Latest false ceiling layout for site.", **file("Villa99_FC_layout_revC.pdf", 842))
    say(sw, at(2, 18, 2), "suresh", "Site closed for the day. 6 workers today.")
    say(sw, at(1, 9, 12), "suresh", "Boards for master bedroom still not here. Following up.")
    say(sw, at(1, 11, 47), "amit", "@Suresh vendor confirmed dispatch at 2 pm today.", data={"mentions": [U["suresh"]]})
    say(sw, at(1, 16, 30), "imran", None, **photos(img("sand", "Base units fixed – kitchen")))
    say(sw, at(1, 18, 5), "suresh", "Kitchen base carcass 25% done. Uppers start tomorrow.")
    say(sw, ago(190), "suresh", "Good morning. 7 workers on site today.")
    say(sw, ago(150), "amit", "@Ravi please finish the living room boarding today, painter wants to start putty on Monday.",
        data={"mentions": [U["ravi"]]})
    say(sw, ago(95), "manju", None, **photos(img("stone", "Master bedroom – waiting for boards")))
    say(sw, ago(40), "suresh", "Boards arrived just now. 24 nos. Unloading.")
    say(sw, ago(22), "amit", "Finally. Thanks for chasing, Suresh.")

    # Villa 99 — #design
    ds = sharma["ch"]["design"]
    say(ds, at(9, 10, 0), "kavya", "Sharing the final false ceiling layout for living + dining.")
    say(ds, at(9, 10, 2), "kavya", None, **photos(img("linen", "Living room ceiling"), img("sage", "Dining cove detail")))
    say(ds, at(9, 10, 30), "amit", "Looks good. Cove depth 4 inches confirmed?")
    say(ds, at(9, 10, 34), "kavya", "Yes, 4 inch cove with a warm white strip.")
    say(ds, at(8, 12, 0), "kavya", "Laminate shortlist for wardrobes — 3 options. Client to pick by Friday.")
    say(ds, at(8, 12, 1), "kavya", None, **photos(img("sand", "Option 1 – walnut"), img("linen", "Option 2 – ash"), img("sage", "Option 3 – olive")))
    say(ds, at(8, 14, 20), "amit", "Option 2 matches the flooring best in my view.")
    say(ds, at(8, 14, 50), "arjun", "Agree with option 2. Keep the handles matte black.", reactions={"👍": ["kavya", "amit"]})
    say(ds, at(7, 11, 15), "kavya", "Client wants the TV unit 6 inches wider, updated drawing attached", **file("TV_unit_revC.pdf", 516))
    say(ds, at(7, 11, 40), "amit", "Does that affect the cove light switch position?")
    say(ds, at(7, 11, 52), "kavya", "No, the switch stays. Only the side panel shifts.")
    say(ds, at(6, 10, 10), "kavya", "Kitchen elevation updated with the taller unit for the oven.")
    say(ds, at(6, 10, 11), "kavya", None, **photos(img("linen", "Kitchen elevation B")))
    say(ds, at(6, 15, 0), "amit", "Imran needs the hinge schedule. Can you share today?")
    say(ds, at(6, 16, 22), "kavya", "Here it is.", **file("Hinge_schedule.pdf", 228))
    say(ds, at(5, 9, 45), "kavya", "Paint shades for approval: living — Morning Fog, bedrooms — Warm Linen.")
    say(ds, at(5, 9, 46), "kavya", None, **photos(img("sage", "Shade card")))
    say(ds, at(5, 13, 10), "meera", "Client approved Morning Fog over call. Please note it.")
    say(ds, at(5, 13, 12), "kavya", "Noted, thank you Meera.")
    say(ds, at(4, 11, 0), "kavya", "Texture wall sample is ready at the studio.", **photos(img("stone", "Texture sample")))
    say(ds, at(4, 11, 30), "amit", "Bring it on Saturday for the client visit.", reactions={"👍": ["kavya"]})
    say(ds, at(3, 10, 0), "kavya", "TV unit rev C issued for site.")
    say(ds, at(3, 10, 2), "amit", "Sent to Imran.")
    say(ds, at(2, 12, 20), "kavya", "Study table: client wants a cable tray added. Small change, no cost impact.")
    say(ds, at(2, 12, 45), "amit", "Ok. Please mark it in the drawing.")
    say(ds, at(1, 15, 0), "kavya", "Wardrobe internals final — master bedroom.", **photos(img("sand", "Wardrobe internals")))
    say(ds, at(1, 15, 25), "amit", "Approved from my side.")
    say(ds, ago(130), "kavya", "Working on the foyer shoe rack detail today.")
    say(ds, ago(60), "kavya", "Foyer detail — two options.", **photos(img("sand", "Foyer option A"), img("linen", "Foyer option B")))
    say(ds, ago(35), "amit", "Option A. Simpler to build.")

    # Villa 99 — #qs (private)
    qs = sharma["ch"]["qs"]
    say(qs, at(8, 10, 5), "rohan", "Rate for Italian marble came in at ₹420/sq ft, ₹35 above budget")
    say(qs, at(8, 10, 20), "amit", "Can we get a second quote?")
    say(qs, at(8, 10, 24), "rohan", "Asked two more vendors. Will have numbers tomorrow.")
    say(qs, at(7, 12, 30), "rohan", "Second quote ₹398/sq ft from Lakshmi Marbles. Delivery in 6 days.")
    say(qs, at(7, 12, 55), "amit", "Go with ₹398. Please raise the PO.")
    say(qs, at(5, 11, 10), "rohan", "Plywood bill passed: ₹1,84,000 for 40 sheets 18mm BWP.")
    say(qs, at(5, 16, 0), "arjun", "What's our running variance on this project?")
    say(qs, at(5, 16, 18), "rohan", "₹62,000 over on materials so far, mostly marble and hardware.")
    say(qs, at(3, 14, 40), "rohan", "Hardware quote (Hettich) is ₹96,500. Ebco alternative ₹71,200.")
    say(qs, at(3, 15, 5), "amit", "Client asked for Hettich. Keep it.")
    say(qs, at(1, 10, 30), "rohan", "Gypsum vendor penalty: asking for a 2% credit for the late delivery.")
    say(qs, ago(75), "rohan", "Carpentry labour bill for week 1 submitted: ₹38,400.")

    # Villa 99 — #general
    sg = sharma["ch"]["general"]
    say(sg, at(9, 8, 50), "amit", "Welcome to Villa 99. Site address and client contact are on the project page.")
    say(sg, at(9, 8, 55), "bot", "Project moved to Execution", type="system")
    say(sg, at(8, 9, 0), "meera", "Reminder: site entry only with ID cards. Society rule.")
    say(sg, at(6, 12, 0), "amit", "Client visit this Saturday 11 am.")
    say(sg, at(6, 12, 10), "kavya", "I'll be there with samples.")
    say(sg, at(4, 17, 30), "suresh", "Lift will be shut for maintenance tomorrow 10–12. Plan material movement.")
    say(sg, at(2, 10, 0), "amit", "Baseline is locked. Any date change now shows as variance.")
    say(sg, at(1, 13, 20), "rohan", "Petty cash topped up, ₹15,000 with Suresh.")
    say(sg, ago(110), "amit", "We are 4 days behind baseline, mainly the gypsum delay. Let's recover it in carpentry.")
    say(sg, ago(50), "suresh", "Will add two carpenters from Monday.")

    # RV University
    md = mehta["ch"]["design"]
    say(md, at(6, 11, 0), "kavya", "Site measurement done. The block is 3,400 sq ft across two floors.", **photos(img("stone", "Ground floor – lobby")))
    say(md, at(5, 15, 0), "kavya", "Moodboard v1 — warm modern, lots of teak.", **photos(img("sand", "Moodboard – teak"), img("sage", "Moodboard – soft greens")))
    say(md, at(5, 16, 30), "arjun", "Like the direction. The client prefers lighter wood, keep an oak option.")
    say(md, at(4, 10, 15), "kavya", "Adding an oak option.")
    say(md, at(3, 12, 0), "kavya", "Concept layouts A and B shared with the client.")
    say(md, at(2, 17, 45), "kavya", "Client picked layout B with a bigger reception area.")
    say(md, at(1, 10, 0), "kavya", "Starting 3D renders for the lobby and cafeteria.")
    say(md, ago(140), "kavya", "First render draft by tomorrow evening.")
    say(mehta["ch"]["general"], at(6, 9, 30), "kavya", "RV University kicked off. Design stage runs about two weeks.")
    say(mehta["ch"]["general"], at(2, 18, 0), "meera", "Agreement signed copy received from client.")
    say(mehta["ch"]["general"], ago(170), "rohan", "I will start the BOQ once layout B drawings are frozen.")
    say(mehta["ch"]["qs"], at(3, 16, 0), "rohan", "Rough budget from client: ₹48 lakh all-in.")
    say(mehta["ch"]["qs"], at(2, 11, 0), "kavya", "Keep 8% contingency in the estimate.")
    say(mehta["ch"]["qs"], ago(160), "rohan", "Noted. First estimate by next Wednesday.")

    # OITH
    cs = cafe["ch"]["site-work"]
    say(cs, at(5, 10, 0), "suresh", "Counter stone fixed. Polishing tomorrow.")
    say(cs, at(4, 11, 20), "prakash", None, **photos(img("linen", "Bar counter – stone fixed")))
    say(cs, at(4, 11, 40), "amit", "Looks sharp.")
    say(cs, at(3, 15, 0), "suresh", "Signage backing ply done.")
    say(cs, at(2, 13, 10), "lakshmi", "Wall paint final coat finished in the seating area.", **photos(img("sage", "Seating area – final coat")))
    say(cs, at(2, 13, 30), "amit", "One day ahead of plan. Great work.", reactions={"🎉": ["suresh", "lakshmi"]})
    say(cs, at(1, 17, 0), "suresh", "Light fixtures arriving tomorrow.")
    say(cs, ago(170), "prakash", "Fixtures received. 22 pendant lights.")
    say(cs, ago(80), "suresh", "Pendant installation started.")
    say(cafe["ch"]["general"], at(5, 9, 0), "amit", "Handover target is next week. Client wants a soft launch on the weekend after.")
    say(cafe["ch"]["general"], at(3, 10, 0), "meera", "Fire NOC inspection is booked for Thursday.")
    say(cafe["ch"]["general"], at(1, 12, 0), "suresh", "Deep cleaning team booked.")
    say(cafe["ch"]["general"], ago(120), "amit", "Signage vendor confirmed install for day after tomorrow.")
    say(cafe["ch"]["design"], at(4, 14, 0), "amit", "Signage artwork final from client attached.", **file("OITH_signage_final.pdf", 1240))
    say(cafe["ch"]["qs"], at(2, 15, 0), "amit", "Pendant lights invoice: ₹1,12,000. Within budget.")

    # Company channels
    say(announcements, at(8, 9, 0), "arjun", "Welcome to Siteline. From today all project updates go here, not on WhatsApp.")
    say(announcements, at(5, 10, 0), "meera", "Diwali holidays: sites closed 20–22 Oct. Plan deliveries accordingly.")
    say(announcements, at(1, 18, 30), "arjun", "We won the RV University project. Kavya leads it. 🎉", reactions={"🎉": ["amit", "kavya", "suresh"]})
    say(company_general, at(7, 10, 0), "meera", "ID cards are ready. Collect from the office.")
    say(company_general, at(6, 11, 0), "suresh", "Collected for the Villa 99 team.")
    say(company_general, at(3, 9, 30), "kavya", "Anyone has the Asian Paints fan deck? Need it for Saturday.")
    say(company_general, at(3, 9, 50), "amit", "It's in my car. Will drop it at the studio.")
    say(company_general, at(1, 16, 0), "meera", "Timesheets due Friday.")
    say(company_general, ago(200), "arjun", "Good work on OITH, team. One day ahead.")

    # DMs
    say(dm_amit_ravi, at(2, 8, 30), "amit", "Ravi, are you coming to site tomorrow?")
    say(dm_amit_ravi, at(2, 8, 45), "ravi", "Yes sir, 9 am.")
    say(dm_amit_ravi, at(1, 19, 0), "amit", "Good work on the living room ceiling.")
    say(dm_amit_ravi, ago(140), "amit", "Send me a photo once the boarding is finished.")
    say(dm_amit_suresh, at(3, 20, 0), "amit", "Can we recover two days in carpentry?")
    say(dm_amit_suresh, at(3, 20, 15), "suresh", "Possible with two more carpenters. I will check with Imran.")
    say(dm_amit_suresh, at(1, 8, 10), "suresh", "Imran can bring two people from Monday.")
    say(dm_amit_suresh, ago(100), "amit", "Please go ahead. I will inform the client.")
    say(dm_arjun_amit, at(4, 18, 0), "arjun", "How is Villa 99 looking?")
    say(dm_arjun_amit, at(4, 18, 20), "amit", "4 days behind because of gypsum boards. Recovery plan in carpentry.")
    say(dm_arjun_amit, at(4, 18, 25), "arjun", "Ok. Keep the client informed.")
    say(dm_arjun_amit, ago(90), "arjun", "Send me the revised finish date today please.")

    # Bot DMs
    for k in human_keys:
        say(bot_dm[k], at(8, 9, 1), "bot", "Hi! I will check in on your tasks here. Tap a button to answer — no typing needed.")
    say(bot_dm["ravi"], ago(420), "bot", None, data={
        "kind": "morning_summary", "taskIds": [T["False ceiling – living room"], T["False ceiling – master bedroom"]],
    })
    ci_time = ago(6)
    checkin_id = uuid_at(ci_time)
    checkin_msg = say(bot_dm["ravi"], ci_time, "bot", None, type="checkin",
                      data={"checkinId": checkin_id, "taskId": T["False ceiling – living room"]})
    s.checkins[checkin_id] = {"id": checkin_id, "taskId": T["False ceiling – living room"], "userId": U["ravi"],
                              "askedAt": iso(ci_time), "answer": None, "messageId": checkin_msg, "updatedAt": iso(ci_time),
                              "remindedAt": None, "escalatedAt": None}

    # ---- Task history ----
    def hist(task_name: str, user: str, field: str, old: str | None, new: str | None, ms: int, via: str = "app") -> None:
        s.task_history.append({"id": uuid_at(ms), "taskId": T[task_name], "userId": U[user], "field": field,
                               "from": old, "to": new, "via": via, "createdAt": iso(ms)})

    hist("False ceiling – living room", "ravi", "status", "not_started", "in_progress", at(7, 9, 30))
    hist("False ceiling – living room", "ravi", "percent", "0", "25", at(6, 18, 4), "checkin")
    hist("False ceiling – living room", "amit", "plannedFinish", day(-2), day(2), at(4, 10, 0))
    hist("False ceiling – living room", "ravi", "percent", "25", "50", at(3, 18, 2), "checkin")
    hist("False ceiling – master bedroom", "suresh", "status", "in_progress", "blocked", at(6, 9, 30))
    hist("False ceiling – master bedroom", "amit", "plannedFinish", day(-1), day(3), at(4, 10, 0))
    hist("Kitchen carcass", "imran", "status", "not_started", "in_progress", at(3, 10, 5))
    hist("Kitchen carcass", "suresh", "percent", "0", "25", at(1, 18, 5))
    hist("Pendant lights", "suresh", "percent", "0", "50", ago(80))
    hist("3D renders – lobby & cafeteria", "kavya", "status", "not_started", "in_progress", at(1, 10, 0))

    # ---- Activity ----
    def activity(user: str, kind: str, actor: str, created: str, *, channel_id=None, message_id=None, task_ids=(),
                 text: str, lines=(), project_id=None) -> None:
        s.activities.append({"id": uuid_at(int(datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() * 1000)),
                             "userId": U[user], "kind": kind, "actorId": U[actor], "projectId": project_id or sharma["id"],
                             "channelId": channel_id, "messageId": message_id, "taskIds": list(task_ids), "text": text,
                             "lines": list(lines), "createdAt": created, "readAt": None})

    for who, prefix in (("ravi", "@Ravi"), ("suresh", "@Suresh")):
        m = next((m for m in s.messages.values() if (m["body"] or "").startswith(prefix)), None)
        if m:
            activity(who, "mention", "amit", m["createdAt"], channel_id=sw, message_id=m["id"],
                     text="Amit mentioned you in #site-work", lines=[m["body"] or ""])
    activity("amit", "checkin_result", "ravi", iso(at(3, 18, 2)), channel_id=sw, task_ids=[T["False ceiling – living room"]],
             text="Ravi updated False ceiling – living room to 50%")
    activity("suresh", "thread_reply", "ravi", iso(at(6, 9, 48)), channel_id=sw, message_id=thread,
             text="Ravi replied to your message in #site-work", lines=["Ok sir, we will continue living room till then."])
    activity("ravi", "task_assigned", "amit", iso(at(7, 9, 0)), task_ids=[T["False ceiling – living room"]],
             text="Amit assigned you False ceiling – living room")

    # ---- Read markers: leave a few unread messages per channel for everyone ----
    by_channel: dict[str, list[dict]] = {}
    for m in s.messages.values():
        if not m["threadParentId"]:
            by_channel.setdefault(m["channelId"], []).append(m)
    for lst in by_channel.values():
        lst.sort(key=lambda m: m["id"])
    n = 0
    for cm in s.channel_members:
        lst = by_channel.get(cm["channelId"], [])
        if not lst:
            continue
        ch = s.channels[cm["channelId"]]
        busy = ch["name"] in ("site-work", "design", "announcements")
        if ch["kind"] == "bot":
            unread = 2 if cm["userId"] == U["ravi"] else 0
        else:
            unread = (n % 4) or (2 if busy else 0)
            n += 1
        idx = len(lst) - 1 - unread
        cm["lastReadMessageId"] = lst[idx]["id"] if idx >= 0 else None

    return s
