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
        # Resolve mentor + member emails to AAD object ids
        candidates: list[tuple[str, bool]] = []  # (email, is_owner)
        if team.mentor_email:
            candidates.append((team.mentor_email.strip(), True))
        for m in team.members:
            if m.email:
                candidates.append((m.email.strip(), False))

        if not candidates:
            raise _GraphChannelError(400, "No mentor or member emails on file for this team")

        member_ids: list[str] = []
        owner_ids: set[str] = set()
        unresolved: list[str] = []
        for email, is_owner in candidates:
            uid = _graph_get_user_id(gc, email)
            if not uid:
                unresolved.append(email)
                continue
            if uid not in member_ids:
                member_ids.append(uid)
            if is_owner:
                owner_ids.add(uid)

        # Teams channels need at least one owner — promote first member if mentor unresolved.
        if not owner_ids and member_ids:
            owner_ids.add(member_ids[0])

        if not member_ids:
            raise _GraphChannelError(
                400,
                f"None of the team's emails could be resolved in Azure AD: {', '.join(unresolved)}",
            )

        members_payload: list[dict] = []
        for uid in member_ids:
            members_payload.append({
                "@odata.type": "#microsoft.graph.aadUserConversationMember",
                "user@odata.bind": f"{GRAPH}/users('{uid}')",
                "roles": ["owner"] if uid in owner_ids else [],
            })

        body = {
            "@odata.type": "#Microsoft.Graph.channel",
            "membershipType": "private",
            "displayName": display_name,
            "description": description,
            "members": members_payload,
        }
        r = gc.post(f"{GRAPH}/teams/{PARENT_TEAM_ID}/channels", json=body)
        if r.status_code not in (200, 201, 202):
            # Pull the full Graph error body (truncated headers cut us off
            # at 300 chars before). Also surface the request-id so IT can
            # correlate with Graph telemetry if the error is opaque.
            req_id = r.headers.get("request-id") or r.headers.get("client-request-id") or "?"
            raise _GraphChannelError(
                502,
                (
                    f"Graph channel create failed ({r.status_code}) "
                    f"[req {req_id}]: {r.text[:2000]} | "
                    f"display_name={display_name!r}, members={len(member_ids)}, "
                    f"owners={len(owner_ids)}, unresolved={unresolved}"
                ),
            )
        channel_id = (r.json() or {}).get("id", "") if r.text else ""

    # Persist + audit
    team.has_teams_channel = True
    team.teams_channel_id = channel_id
    team.teams_channel_created_at = datetime.utcnow()
    log(
        db, team.id, kind="teams_channel_create",
        subject=f"Channel created: {team.name}",
        body=f"Channel ID: {channel_id} · {len(member_ids)} member(s), {len(owner_ids)} owner(s)" +
             (f" · unresolved: {', '.join(unresolved)}" if unresolved else ""),
        status="sent",
        sent_by_email=sent_by_email,
    )
    return {
        "channel_id": channel_id,
        "status": "sent",
        "display_name": display_name,
        "members_added": len(member_ids),
        "owners": len(owner_ids),
        "unresolved_emails": unresolved,
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
