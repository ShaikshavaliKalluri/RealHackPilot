"""Teams channels + broadcast + audit log.

The legacy bulk paths (`create_team_channel`, `broadcast`, etc.) still run in
MOCK mode by default because they happen server-side without a user token.
The per-team button on the dashboard uses the new `create_team_channel_with_graph_token`
function which takes a delegated Graph access token fetched in the browser
via MSAL — that one ALWAYS hits real Graph (or the sandbox short-circuit).

Audit log captures everything — both mocked and real calls.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from typing import Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Team, CommLog
from . import github as gh
from .scheduling import ORGANIZER_CC_EMAILS


# Mode flag — flip to "graph" once the app registration is in place.
GRAPH_MODE = os.environ.get("GRAPH_MODE", "mock")
DUPLICATE_WINDOW_HOURS = 24
GRAPH = "https://graph.microsoft.com/v1.0"
PARENT_TEAM_ID = os.environ.get("GRAPH_PARENT_TEAM_ID", "")


# ===== Audit log helpers =====

def log(
    db: Session,
    team_id: int | None,
    kind: str,
    template_id: str | None = None,
    subject: str | None = None,
    body: str | None = None,
    recipients: list[str] | None = None,
    status: str = "sent",
    sent_by_email: str | None = None,
) -> CommLog:
    entry = CommLog(
        team_id=team_id,
        kind=kind,
        template_id=template_id,
        subject=subject,
        body=body,
        recipients=recipients or [],
        status=status,
        sent_by_email=sent_by_email,
    )
    db.add(entry)
    db.flush()
    return entry


def recent_duplicate(db: Session, team_id: int, kind: str, template_id: str | None, hours: int = DUPLICATE_WINDOW_HOURS) -> CommLog | None:
    """Return a recent CommLog matching team+kind+template within the duplicate window."""
    if template_id is None:
        return None
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    return db.execute(
        select(CommLog)
        .where(CommLog.team_id == team_id, CommLog.kind == kind, CommLog.template_id == template_id, CommLog.sent_at >= cutoff)
        .order_by(CommLog.sent_at.desc())
    ).scalars().first()


# ===== Teams channel operations (mock today) =====

def create_team_channel(db: Session, team: Team, sent_by_email: str | None) -> dict:
    if team.has_teams_channel:
        return {"already_exists": True, "channel_id": team.teams_channel_id}

    if GRAPH_MODE == "mock":
        channel_id = f"mock-channel-{uuid.uuid4().hex[:12]}"
        status = "mocked"
    else:
        # TODO: real Graph API once app registration lands
        raise NotImplementedError("Graph mode not yet wired")

    team.has_teams_channel = True
    team.teams_channel_id = channel_id
    team.teams_channel_created_at = datetime.utcnow()

    log(
        db, team.id, kind="teams_channel_create",
        subject=f"Channel created: {team.name}",
        body=f"Channel ID: {channel_id}",
        status=status,
        sent_by_email=sent_by_email,
    )
    return {"channel_id": channel_id, "status": status}


def post_team_message(db: Session, team: Team, message: str, sent_by_email: str | None) -> dict:
    if not team.has_teams_channel:
        # Auto-create on first post (mock)
        create_team_channel(db, team, sent_by_email=sent_by_email)

    status = "mocked" if GRAPH_MODE == "mock" else "sent"
    log(
        db, team.id, kind="teams_message",
        subject=f"Message to {team.name}",
        body=message,
        status=status,
        sent_by_email=sent_by_email,
    )
    return {"status": status, "channel_id": team.teams_channel_id}


def broadcast(db: Session, message: str, team_ids: Iterable[int] | None, sent_by_email: str | None) -> dict:
    teams_q = db.query(Team)
    if team_ids is not None:
        teams_q = teams_q.filter(Team.id.in_(list(team_ids)))
    teams = teams_q.all()

    status = "mocked" if GRAPH_MODE == "mock" else "sent"
    posted: list[int] = []
    for t in teams:
        if not t.has_teams_channel:
            create_team_channel(db, t, sent_by_email=sent_by_email)
        log(
            db, t.id, kind="teams_broadcast",
            subject=f"Broadcast to {t.name}",
            body=message,
            status=status,
            sent_by_email=sent_by_email,
        )
        posted.append(t.id)
    return {"status": status, "posted_to": len(posted), "team_ids": posted, "mode": GRAPH_MODE}


# ===== Real Graph channel creation (per-team button) =====


class _GraphChannelError(Exception):
    """Raised on a non-2xx Graph response so the endpoint can return a clean 4xx."""
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _graph_get_user_id(client: httpx.Client, email: str) -> str | None:
    """Resolve an email/UPN to an Azure AD object id via Graph /users/{key}."""
    r = client.get(f"{GRAPH}/users/{email}")
    if r.status_code == 200:
        return r.json().get("id")
    return None


def _ensure_in_parent_team(client: httpx.Client, user_id: str) -> tuple[bool, str | None]:
    """Add a user to the parent Team if they aren't already a member.

    Microsoft Teams enforces that private-channel members must also be members
    of the parent Team — without this, channel creation fails with a 403
    'users are not part of the parent roster'. We POST adds proactively and
    treat 'already a member' style 4xx responses as no-op success.

    Returns: (was_added, error_message_or_None). was_added is False when the
    user was already in the team (still success). error_message is non-None
    only on genuine failures (e.g. the user can't be invited at all because
    of tenant guest restrictions).
    """
    payload = {
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        "roles": [],
        "user@odata.bind": f"{GRAPH}/users('{user_id}')",
    }
    r = client.post(f"{GRAPH}/teams/{PARENT_TEAM_ID}/members", json=payload)
    if r.is_success:
        return True, None
    # "Already a member" comes back as 400/409 with various wordings depending
    # on tenant. Treat any of them as a no-op success so we don't fail on
    # subsequent retries.
    text_lower = (r.text or "").lower()
    already_member_signals = (
        "already a member", "already a part", "already exists",
        "duplicate user", "already in the team",
    )
    if any(sig in text_lower for sig in already_member_signals):
        return False, None
    # Missing tenant-admin consent for TeamMember.ReadWrite.All means the app
    # can't add users to the parent Team itself. The organizer-side workaround
    # is to pre-add everyone manually via the Teams UI; in that case the user
    # is already in the parent Team and the channel POST will succeed even
    # though our auto-add attempt was denied. Don't surface this as a roster
    # failure -- let the channel POST proceed and Teams will reject if the
    # assumption is wrong with its own (clearer) error.
    if r.status_code == 403 and (
        "missing scope" in text_lower
        or "authorization_request" in text_lower
        or "accessdenied" in text_lower
        or "insufficient" in text_lower
    ):
        return False, None
    return False, f"add to parent team failed ({r.status_code}): {r.text[:200]}"


def _truncate_to_bytes(text: str, max_bytes: int) -> str:
    """Truncate `text` to at most `max_bytes` UTF-8 bytes, never splitting a
    multi-byte codepoint mid-sequence and appending an ellipsis if cut.

    Microsoft Teams enforces byte-level limits on channel descriptions
    (ThreadDescriptionLimitExceeded). UTF-8 chars like em-dash, smart
    quotes, or emoji are 2-4 bytes each, so a naive char-based slice can
    easily overshoot the limit on otherwise-short text.
    """
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    # Reserve 3 bytes for the trailing ellipsis ('…' is 3 UTF-8 bytes).
    truncated = encoded[: max(0, max_bytes - 3)]
    # Back off any UTF-8 continuation bytes (0b10xxxxxx) to land on a
    # codepoint boundary before decoding.
    while truncated and (truncated[-1] & 0xC0) == 0x80:
        truncated = truncated[:-1]
    return truncated.decode("utf-8", errors="ignore") + "…"


def create_team_channel_with_graph_token(
    db: Session,
    team: Team,
    graph_token: str,
    sent_by_email: str | None,
    *,
    sandbox: bool = False,
) -> dict:
    """Create a private Microsoft Teams channel for this team using a delegated
    Graph access token acquired on the client. Mirrors the CLI logic in
    provision_team_channels.py but bound to a single team.

    Args:
        db: SQLAlchemy session (prod or sandbox depending on caller).
        team: Team row — must not already have a channel.
        graph_token: delegated Graph access token from MSAL (browser-side).
        sent_by_email: email of the organizer triggering the action; logged.
        sandbox: when True, no real Graph calls happen — we mint a fake
            channel id, write a 'mocked' CommLog entry, and update the team
            row in the sandbox DB. Lets organizers test the UI flow in
            Test Mode without creating real channels in production Teams.

    Returns:
        {"channel_id": str, "status": "sent" | "mocked", "display_name": str}

    Raises:
        _GraphChannelError on any Graph failure (parent team missing, member
        resolution failed, channel POST rejected). The endpoint translates
        this into an HTTPException.
    """
    if team.has_teams_channel:
        return {"channel_id": team.teams_channel_id, "status": "already_exists"}

    display_name = f"2026 {team.name}"[:50]
    description = _truncate_to_bytes(
        (team.idea or f"RealHack 2026 — {team.name}").strip(),
        max_bytes=900,  # Teams Templates backend rejects >~1000 bytes
                        # (ThreadDescriptionLimitExceeded). 900 leaves headroom
                        # for any future quote/escape inflation.
    )

    # ----- Sandbox short-circuit: skip Graph, just write mock entries -----
    if sandbox:
        channel_id = f"sandbox-channel-{uuid.uuid4().hex[:12]}"
        team.has_teams_channel = True
        team.teams_channel_id = channel_id
        team.teams_channel_created_at = datetime.utcnow()
        log(
            db, team.id, kind="teams_channel_create",
            subject=f"[sandbox] Channel created: {team.name}",
            body=f"Mock channel id: {channel_id}",
            status="mocked",
            sent_by_email=sent_by_email,
        )
        return {"channel_id": channel_id, "status": "mocked", "display_name": display_name}

    # ----- Real Graph path -----
    if not PARENT_TEAM_ID:
        raise _GraphChannelError(500, "GRAPH_PARENT_TEAM_ID is not set on the server")

    with httpx.Client(
        headers={"Authorization": f"Bearer {graph_token}", "Content-Type": "application/json"},
        timeout=30,
    ) as gc:
        # Standard channels: skip the email-to-AAD-id resolution + parent-team
        # auto-add work entirely. Every parent-Team member automatically sees
        # standard channels, so we don't need a members array, owner ids, or
        # any of the per-team-member plumbing. The organizer pre-added all
        # participants to the parent Team via Teams UI (since the
        # TeamMember.ReadWrite.All scope isn't admin-consented).
        body = {
            "@odata.type": "#Microsoft.Graph.channel",
            "membershipType": "standard",
            "displayName": display_name,
            "description": description,
        }
        r = gc.post(f"{GRAPH}/teams/{PARENT_TEAM_ID}/channels", json=body)
        if r.status_code not in (200, 201, 202):
            req_id = r.headers.get("request-id") or r.headers.get("client-request-id") or "?"
            raise _GraphChannelError(
                502,
                (
                    f"Graph channel create failed ({r.status_code}) "
                    f"[req {req_id}]: {r.text[:2000]} | "
                    f"display_name={display_name!r}"
                ),
            )
        channel_id = (r.json() or {}).get("id", "") if r.text else ""

    # Persist + audit
    team.has_teams_channel = True
    team.teams_channel_id = channel_id
    team.teams_channel_created_at = datetime.utcnow()
    log_parts = [
        f"Channel ID: {channel_id}",
        "standard channel (inherits parent-Team membership)",
    ]
    log(
        db, team.id, kind="teams_channel_create",
        subject=f"Channel created: {team.name}",
        body=" · ".join(log_parts),
        status="sent",
        sent_by_email=sent_by_email,
    )
    return {
        "channel_id": channel_id,
        "status": "sent",
        "display_name": display_name,
        "channel_type": "standard",
    }


# ===== Channel-message posting (with @mentions) =====

def post_channel_welcome_with_graph_token(
    db: Session,
    team: Team,
    graph_token: str,
    sent_by_email: str | None = None,
) -> dict:
    """Post the RealHack 2026 welcome message to a team's Teams channel with
    @mentions for the mentor and all team members.

    Each person who can be resolved in Azure AD gets an @mention with a
    sequential id. Anyone who can't be resolved is silently skipped — the
    message still posts, just without that person's mention.

    Requires ChannelMessage.Send delegated scope.
    """
    import html

    if not team.has_teams_channel or not team.teams_channel_id:
        raise _GraphChannelError(400, "Team has no Teams channel — create one first")
    if not PARENT_TEAM_ID:
        raise _GraphChannelError(500, "GRAPH_PARENT_TEAM_ID is not set on the server")

    with httpx.Client(
        headers={"Authorization": f"Bearer {graph_token}", "Content-Type": "application/json"},
        timeout=30,
    ) as gc:
        # Resolve mentor + members to AAD user ids.
        people: list[dict] = []  # [{name, aad_id}]
        if team.mentor_email and team.mentor_name:
            uid = _graph_get_user_id(gc, team.mentor_email.strip())
            if uid:
                people.append({
                    "name": team.mentor_name.strip().title(),
                    "aad_id": uid,
                })
        for m in team.members:
            if m.email and m.name:
                uid = _graph_get_user_id(gc, m.email.strip())
                if uid:
                    people.append({
                        "name": m.name.strip().title(),
                        "aad_id": uid,
                    })

        # Build the mentions array + the inline <at> tags
        mentions: list[dict] = []
        mention_tags: list[str] = []
        for i, p in enumerate(people):
            mentions.append({
                "id": i,
                "mentionText": p["name"],
                "mentioned": {
                    "user": {
                        "displayName": p["name"],
                        "id": p["aad_id"],
                        "userIdentityType": "aadUser",
                    },
                },
            })
            mention_tags.append(f'<at id="{i}">{html.escape(p["name"])}</at>')

        team_name_safe = html.escape(team.name)
        mentions_block = ", ".join(mention_tags) if mention_tags else ""

        content = (
            # Header line — sets a clear visual top to the message
            f'<p><strong style="color:#0a4f99;font-size:16px;">'
            f'🎉 Welcome to RealHack 2026</strong></p>'
            # Greeting + body
            f"<p>Dear <strong>{team_name_safe}</strong> Team,</p>"
            f"<p>We are happy to announce confirmation of your nomination for "
            f"<strong>RealHack 2026</strong>.</p>"
            f"<p>You can use your individual team channel for any communication "
            f"among your team members.</p>"
            f"<p>Look forward to your participation in RealHack 2026.</p>"
            # Sign-off in brand blue
            f'<p>Regards,<br>'
            f'<strong style="color:#0a4f99;">Team RealHack</strong></p>'
        )
        if mentions_block:
            # Drop the 'cc:' prefix per organizer feedback. Plain inline
            # mentions so Teams still fires notifications + renders pills.
            content += f"<p>{mentions_block}</p>"

        payload = {
            "body": {
                "contentType": "html",
                "content": content,
            },
            "mentions": mentions,
        }

        url = f"{GRAPH}/teams/{PARENT_TEAM_ID}/channels/{team.teams_channel_id}/messages"
        r = gc.post(url, json=payload)
        if r.status_code not in (200, 201):
            req_id = r.headers.get("request-id") or r.headers.get("client-request-id") or "?"
            raise _GraphChannelError(
                502,
                f"Channel message post failed ({r.status_code}) [req {req_id}]: {r.text[:1500]}",
            )

        msg_id = (r.json() or {}).get("id", "")

    log(
        db, team.id, kind="teams_message",
        subject=f"Welcome message posted: {team.name}",
        body=f"Message ID: {msg_id} · {len(mentions)} @mention(s)",
        status="sent",
        sent_by_email=sent_by_email,
    )
    return {
        "message_id": msg_id,
        "mentions_count": len(mentions),
        "status": "sent",
    }


# ===== Readiness check =====

def check_repo_readiness(team: Team) -> dict:
    """Inspect the team's repo URL — does it look like a working POC?"""
    if not team.repo_url:
        team.repo_ready = False
        team.repo_check_notes = "No repo URL set"
        return {"ready": False, "notes": team.repo_check_notes}

    ctx = gh.fetch_context(team.repo_url)
    if ctx.get("error"):
        team.repo_ready = False
        team.repo_check_notes = f"Repo fetch failed: {ctx['error']}"
        return {"ready": False, "notes": team.repo_check_notes, "github": ctx}

    notes_parts: list[str] = []
    if ctx.get("readme_excerpt"):
        notes_parts.append("README present")
    else:
        notes_parts.append("No README")
    if ctx.get("language"):
        notes_parts.append(f"language={ctx['language']}")
    if ctx.get("languages"):
        notes_parts.append(f"{len(ctx['languages'])} language(s)")
    if ctx.get("pushed_at"):
        notes_parts.append(f"last pushed {ctx['pushed_at'][:10]}")

    ready = bool(ctx.get("readme_excerpt")) and bool(ctx.get("language"))
    team.repo_ready = ready
    team.repo_check_notes = " · ".join(notes_parts)
    return {"ready": ready, "notes": team.repo_check_notes, "github": ctx}
