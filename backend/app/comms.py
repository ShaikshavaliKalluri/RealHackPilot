"""Teams channels + broadcast + audit log.

Today: runs in MOCK mode (we don't have the Azure AD app registration yet).
The interface is identical to what the real Graph API integration will use,
so swap-in is one function replacement.

Audit log captures everything — both mocked and (when wired) real calls.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Team, CommLog
from . import github as gh


# Mode flag — flip to "graph" once the app registration is in place.
GRAPH_MODE = os.environ.get("GRAPH_MODE", "mock")
DUPLICATE_WINDOW_HOURS = 24


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
