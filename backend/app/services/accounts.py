"""Accounts and sessions (spec §9.4–9.6): sign-in codes, sessions per company, invites, joining a company,
deactivation. A person has one account (their work email) and a membership in each company."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets

from .. import config, db
from ..core import ApiError, avatar_tone, invalid, uuid7
from ..events import publish
from ..jobs.queue import enqueue
from ..store import BOT_ID

CODE_TTL = "10 minutes"
MAX_ATTEMPTS = 5
PER_IDENTIFIER_PER_HOUR = 5
PER_IP_PER_HOUR = 20

# Ordinary addresses only (letters, digits and . _ % + ' - before the @; a real domain after it).
EMAIL = re.compile(r"^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$")


# ---- Identifiers ----

def normalize_identifier(raw: str) -> str:
    """A work email, in lower case. People are known only by their email (no phone sign-in)."""
    value = (raw or "").strip().lower()
    if not EMAIL.match(value):
        raise invalid({"identifier": "Enter a valid work email"})
    return value


def user_by_identifier(identifier: str) -> dict | None:
    return db.row("SELECT * FROM users WHERE email = %(v)s AND deleted_at IS NULL AND NOT is_bot", v=identifier)


def _hash(value: str) -> str:
    return hmac.new(config.SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()


# ---- Sign-in codes ----

def pending_invites(identifier: str) -> list[dict]:
    return db.rows("""SELECT i.*, c.name AS company_name, u.name AS invited_by_name FROM invites i
                      JOIN companies c ON c.id = i.company_id AND c.status = 'active'
                      LEFT JOIN users u ON u.id = i.invited_by
                      WHERE i.identifier = %(v)s AND i.status = 'pending' AND i.expires_at > now()
                      ORDER BY i.created_at""", v=identifier)


def request_code(identifier: str, ip: str, *, may_sign_in=None, send_to: str | None = None) -> None:
    """Sends a code when the address may sign in (by default: it belongs to someone or has an invite). The reply is the
    same either way. The limits (per address and per IP) and the 5-try rule are the same for every sign-in, the
    platform panel's included (it passes its own `may_sign_in` and an identifier of its own)."""
    # Requests at the same moment queue here, so each one sees the others in the count (no "50 at once").
    db.run("SELECT pg_advisory_xact_lock(hashtext(%(k)s))", k="otp-ip:" + ip)
    db.run("SELECT pg_advisory_xact_lock(hashtext(%(k)s))", k="otp-id:" + identifier)
    db.run("DELETE FROM otp_requests WHERE at < now() - interval '1 hour'")
    by_id = db.value("SELECT count(*) FROM otp_requests WHERE identifier = %(v)s AND at > now() - interval '1 hour'", v=identifier)
    by_ip = db.value("SELECT count(*) FROM otp_requests WHERE ip = %(ip)s AND at > now() - interval '1 hour'", ip=ip)
    if by_id >= PER_IDENTIFIER_PER_HOUR or by_ip >= PER_IP_PER_HOUR:
        raise ApiError("RATE_LIMITED", "Too many codes asked for. Try again in an hour.")
    db.run("INSERT INTO otp_requests (identifier, ip) VALUES (%(v)s, %(ip)s)", v=identifier, ip=ip)
    allowed = may_sign_in(identifier) if may_sign_in else (user_by_identifier(identifier) or pending_invites(identifier))
    if not allowed:
        return
    code = config.fixed_code_for(identifier) or f"{secrets.randbelow(1_000_000):06d}"
    db.run(f"""INSERT INTO otp_codes (identifier, code_hash, expires_at, attempts) VALUES (%(v)s, %(h)s, now() + interval '{CODE_TTL}', 0)
               ON CONFLICT (identifier) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
               attempts = 0, created_at = now()""", v=identifier, h=_hash(identifier + code))
    enqueue("send_code", {"identifier": send_to or identifier, "code": code}, company_id=None)


def check_code(identifier: str, code: str) -> None:
    """Every try is counted in the database before the code is compared, so guesses sent at the same moment
    can't get past the limit."""
    row = db.row("""UPDATE otp_codes SET attempts = attempts + 1 WHERE identifier = %(v)s
                    RETURNING code_hash, attempts, expires_at < now() AS expired""", v=identifier)
    if not row:
        raise ApiError("OTP_INVALID", "That code is not right.", {"attemptsLeft": MAX_ATTEMPTS})
    if row["attempts"] > MAX_ATTEMPTS:
        raise ApiError("OTP_TOO_MANY_ATTEMPTS", "Too many wrong codes. Request a new code.")
    if row["expired"]:
        raise ApiError("OTP_EXPIRED", "That code has expired. Request a new one.")
    if not hmac.compare_digest(row["codeHash"], _hash(identifier + code)):
        if row["attempts"] >= MAX_ATTEMPTS:
            raise ApiError("OTP_TOO_MANY_ATTEMPTS", "Too many wrong codes. Request a new code.")
        raise ApiError("OTP_INVALID", "That code is not right.", {"attemptsLeft": MAX_ATTEMPTS - row["attempts"]})
    db.run("DELETE FROM otp_codes WHERE identifier = %(v)s", v=identifier)


def account_for(identifier: str) -> dict:
    """The person's account, made on their first sign-in from an invite."""
    user = user_by_identifier(identifier)
    if user:
        return user
    invites = pending_invites(identifier)
    if not invites:  # the invite was cancelled or expired between asking for the code and entering it
        raise ApiError("INVITE_EXPIRED", "This invite has expired or was cancelled. Ask for a new one.")
    invite = invites[0]
    uid = uuid7()
    return db.insert("users", {"id": uid, "name": invite["name"], "avatarColor": avatar_tone(uid), "email": identifier})


# ---- Sessions ----

def create_session(user_id: str, company_id: str | None, device: str | None = None) -> dict:
    """A company session gets an access and a refresh token; a session without a company (signed in,
    company not picked) only gets an access token for the /auth routes."""
    access = f"at_{secrets.token_urlsafe(32)}"
    refresh = f"rt_{secrets.token_urlsafe(32)}" if company_id else None
    db.run(f"""INSERT INTO sessions (id, user_id, company_id, access_hash, access_expires_at, refresh_hash,
                                     refresh_expires_at, device)
               VALUES (%(id)s, %(u)s, %(c)s, %(a)s, now() + interval '{config.ACCESS_TTL_SECONDS} seconds', %(r)s,
                       now() + interval '{config.REFRESH_TTL_SECONDS} seconds', %(d)s)""",
           id=uuid7(), u=user_id, c=company_id, a=_hash(access), r=_hash(refresh) if refresh else None, d=device)
    return {"accessToken": access, "refreshToken": refresh}


def session_for_access(token: str) -> dict | None:
    if not token:
        return None
    s = db.row("""SELECT * FROM sessions WHERE access_hash = %(h)s AND revoked_at IS NULL AND access_expires_at > now()""",
               h=_hash(token))
    if s and not s["accessUsed"]:  # the phone has the tokens from its last refresh: an older refresh token is now a copy
        db.run("UPDATE sessions SET access_used = true WHERE id = %(id)s", id=s["id"])
    return s


def refresh_session(token: str) -> dict:
    """New access and refresh tokens; the refresh token is single-use.
    The previous refresh token is accepted again only while the tokens that replaced it are unused: then the phone
    never got the reply (lost on a bad line) and is retrying. Once the new access token has been used, the previous
    refresh token can only be a copy, and using it ends the session."""
    h = _hash(token or "")
    s = db.row("""SELECT * FROM sessions WHERE refresh_hash = %(h)s AND revoked_at IS NULL AND refresh_expires_at > now()
                  FOR UPDATE""", h=h)
    retry = False
    if not s:
        s = db.row("""SELECT * FROM sessions WHERE previous_refresh_hash = %(h)s AND revoked_at IS NULL
                      AND refresh_expires_at > now() FOR UPDATE""", h=h)
        if not s:
            raise ApiError("AUTH_EXPIRED", "Your session has expired.")
        if s["accessUsed"]:
            revoke_session(s["id"])
            raise ApiError("AUTH_EXPIRED", "Your session has expired.")
        retry = True
    access, refresh = f"at_{secrets.token_urlsafe(32)}", f"rt_{secrets.token_urlsafe(32)}"
    db.run(f"""UPDATE sessions SET access_hash = %(a)s, access_expires_at = now() + interval '{config.ACCESS_TTL_SECONDS} seconds',
                                   previous_refresh_hash = CASE WHEN %(retry)s THEN previous_refresh_hash ELSE refresh_hash END,
                                   refresh_hash = %(r)s, access_used = false, last_used_at = now()
               WHERE id = %(id)s""", a=_hash(access), r=_hash(refresh), retry=retry, id=s["id"])
    return {"accessToken": access, "refreshToken": refresh, "session": s}


def revoke_session(session_id: str) -> None:
    db.run("UPDATE sessions SET revoked_at = now() WHERE id = %(id)s AND revoked_at IS NULL", id=session_id)


def end_company_sessions(user_id: str, company_id: str) -> None:
    """Signs the person out of this company everywhere and closes their live connections to it."""
    db.run("UPDATE sessions SET revoked_at = now() WHERE user_id = %(u)s AND company_id = %(c)s AND revoked_at IS NULL",
           u=user_id, c=company_id)
    publish({"type": "session.ended"}, [user_id])


def expire_access_tokens(user_id: str, company_id: str) -> None:
    """Dev panel: the next request gets a 401 and the app refreshes."""
    db.run("UPDATE sessions SET access_expires_at = now() WHERE user_id = %(u)s AND company_id = %(c)s", u=user_id, c=company_id)


# ---- Companies a person can open ----

def companies_for(user_id: str) -> list[dict]:
    return db.rows("""SELECT c.id, c.name, m.role FROM memberships m JOIN companies c ON c.id = m.company_id
                      WHERE m.user_id = %(u)s AND m.status = 'active' AND c.status = 'active' ORDER BY c.name""", u=user_id)


def identifiers_of(user: dict) -> list[str]:
    return [user["email"]] if user.get("email") else []


def invites_for(user: dict) -> list[dict]:
    out = []
    for ident in identifiers_of(user):
        out += pending_invites(ident)
    return [{"id": i["id"], "companyId": i["companyId"], "companyName": i["companyName"], "role": i["role"],
             "invitedBy": i["invitedByName"]} for i in out]


def membership(user_id: str, company_id: str) -> dict | None:
    return db.row("""SELECT m.*, c.status AS company_status FROM memberships m JOIN companies c ON c.id = m.company_id
                     WHERE m.user_id = %(u)s AND m.company_id = %(c)s""", u=user_id, c=company_id)


# ---- Joining a company ----

def join_company(company_id: str, user_id: str, role: str, channel_ids: list[str] | None = None) -> None:
    """Membership plus the starting channels: both company channels and a bot DM; guests get only the
    channels they were given. Runs with the transaction switched to that company."""
    with db.as_company(company_id):
        db.run("""INSERT INTO memberships (company_id, user_id, role, status) VALUES (%(c)s, %(u)s, %(r)s, 'active')
                  ON CONFLICT (company_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = now()""",
               c=company_id, u=user_id, r=role)
        from ..store import add_channel_member

        if role != "guest":
            for ch in db.rows("SELECT id FROM channels WHERE kind = 'company'"):
                add_channel_member(ch["id"], user_id)
        else:
            # A guest joins the projects of the channels they were given (spec §5.13).
            for ch in db.rows("SELECT id, project_id FROM channels WHERE id = ANY(%(ids)s) AND kind = 'project'",
                              ids=list(channel_ids or [])):
                db.run("""INSERT INTO project_members (company_id, project_id, user_id) VALUES (%(c)s, %(p)s, %(u)s)
                          ON CONFLICT DO NOTHING""", c=company_id, p=ch["projectId"], u=user_id)
                add_channel_member(ch["id"], user_id)
        if not db.value("""SELECT 1 FROM channels c JOIN channel_members m ON m.channel_id = c.id
                           WHERE c.kind = 'bot' AND m.user_id = %(u)s""", u=user_id):
            bot_dm = db.insert("channels", {"id": uuid7(), "companyId": company_id, "projectId": None, "name": "Siteline Bot",
                                            "kind": "bot", "isPrivate": True, "postingPolicy": "everyone"})
            add_channel_member(bot_dm["id"], user_id)
            db.insert("messages", {"id": uuid7(), "companyId": company_id, "channelId": bot_dm["id"], "senderId": BOT_ID,
                                   "type": "text", "body": "Hi! I will check in on your tasks here. Tap a button to answer — no typing needed."})
        from ..store import human_ids, person
        from ..views import public_user

        publish({"type": "user.updated", "user": public_user(person(user_id))}, human_ids())
        _tell_pm_app("person.joined", user_id)


def _tell_pm_app(event: str, user_id: str) -> None:
    """person.joined / person.left, so the PM app knows who it can send cards to (in the current company)."""
    from .integrations import send_event

    u = db.row("SELECT name, email FROM users WHERE id = %(u)s", u=user_id)
    if u and u["email"]:
        send_event(event, {"person": u["email"], "name": u["name"]}, f"evt_{uuid7()}")


def accept_invite(user: dict, invite_id: str) -> dict:
    invite = db.row("SELECT * FROM invites WHERE id = %(id)s AND status = 'pending' AND expires_at > now()", id=invite_id)
    if not invite or invite["identifier"] not in identifiers_of(user):
        raise ApiError("INVITE_EXPIRED", "This invite has expired or was cancelled. Ask for a new one.")
    join_company(invite["companyId"], user["id"], invite["role"], invite["channelIds"])
    db.run("UPDATE invites SET status = 'accepted' WHERE id = %(id)s", id=invite_id)
    audit(invite["companyId"], user["id"], "invite.accepted", invite_id)
    return invite


def decline_invite(user: dict, invite_id: str) -> None:
    """Only an invite sent to this person; anything else is "not found"."""
    if not db.row("""UPDATE invites SET status = 'declined' WHERE id = %(id)s AND status = 'pending'
                     AND identifier = ANY(%(ids)s) RETURNING id""", id=invite_id, ids=identifiers_of(user)):
        raise ApiError("NOT_FOUND", "This invite isn't available.")


def deactivate_member(user_id: str) -> None:
    """Archive, never delete: they can't open this company, their messages and history stay."""
    company_id = db.company_id()
    db.run("""UPDATE memberships SET status = 'deactivated', updated_at = now()
              WHERE company_id = current_company() AND user_id = %(u)s""", u=user_id)
    end_company_sessions(user_id, company_id)
    _tell_pm_app("person.left", user_id)


def delete_account(user_id: str) -> None:
    """Spec §9.8: details removed, every membership deactivated, messages stay as "Former member"."""
    for m in db.rows("SELECT company_id FROM memberships WHERE user_id = %(u)s AND status = 'active'", u=user_id):
        with db.as_company(m["companyId"]):
            _tell_pm_app("person.left", user_id)
    db.run("""UPDATE users SET name = 'Former member', email = NULL, deleted_at = now(), updated_at = now()
              WHERE id = %(u)s""", u=user_id)
    db.run("UPDATE memberships SET status = 'deactivated', updated_at = now() WHERE user_id = %(u)s", u=user_id)
    db.run("UPDATE sessions SET revoked_at = now() WHERE user_id = %(u)s AND revoked_at IS NULL", u=user_id)
    db.run("DELETE FROM push_tokens WHERE user_id = %(u)s", u=user_id)


def audit(company_id: str | None, actor: str, action: str, target: str | None = None, data: dict | None = None) -> None:
    db.insert("audit_log", {"id": uuid7(), "companyId": company_id, "actor": actor, "action": action, "target": target,
                            "data": data or {}})
