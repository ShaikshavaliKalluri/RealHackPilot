"""Deterministic email templates with per-team mail-merge.

Each template defines: id, label, description, subject, body, audience.
Tokens are simple {token} substitutions filled from the team record.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlalchemy.orm import Session

from .models import Team


CRITICAL_FIELDS = {
    "idea": "Idea / Problem statement",
    "tools": "Tech stack",
    "approach": "Approach",
    "viability": "Viability",
    "business_value": "Business value",
}


@dataclass
class EmailTemplate:
    id: str
    label: str
    description: str
    audience: str  # 'team' | 'mentor' | 'all'
    subject: str
    body: str


TEMPLATES: list[EmailTemplate] = [
    EmailTemplate(
        id="welcome",
        label="Welcome — registration confirmed",
        description="Sent to team members right after a clean registration.",
        audience="team",
        subject="RealHack 2026 — your team {team_name} is registered",
        body=(
            "Hi {member_first_names_or_team},\n\n"
            "You're confirmed for RealHack 2026 (June 18–19).\n\n"
            "Team: {team_name}\n"
            "Mentor: {mentor_name}\n"
            "Members:\n{member_list}\n\n"
            "Idea on file:\n  {idea_short}\n\n"
            "Next steps:\n"
            "  1. Your Teams channel will be created in the next few days.\n"
            "  2. Watch your inbox for the kickoff message.\n"
            "  3. Mentor will reach out to align before the event.\n\n"
            "If anything above looks wrong, reply to RealHack@realpage.com.\n\n"
            "— RealHack Organizing Team"
        ),
    ),
    EmailTemplate(
        id="fix_it",
        label="Fix-it — incomplete submission",
        description="Sent to teams whose submission is missing or vague in critical fields.",
        audience="team",
        subject="RealHack 2026 — please complete your submission for {team_name}",
        body=(
            "Hi {member_first_names_or_team},\n\n"
            "Thanks for registering team {team_name} for RealHack 2026.\n\n"
            "When we reviewed your submission, the following field(s) were either empty, "
            "marked TBD, or too brief to evaluate:\n\n"
            "{missing_fields_block}\n\n"
            "Could you update the registration with a more detailed answer for each of "
            "the above? The deadline is May 19, 2026 and will not be extended.\n\n"
            "If you're unsure what to write or want to discuss the idea, your mentor "
            "({mentor_name}) is available to help.\n\n"
            "— RealHack Organizing Team"
        ),
    ),
    EmailTemplate(
        id="mentor_confirm",
        label="Mentor — please confirm your teams",
        description="Sent to mentors to verify their team assignment.",
        audience="mentor",
        subject="RealHack 2026 — please confirm you'll mentor {team_name}",
        body=(
            "Hi {mentor_name},\n\n"
            "Team {team_name} listed you as their mentor for RealHack 2026 (June 18–19).\n\n"
            "Team members:\n{member_list}\n\n"
            "Idea on file:\n  {idea_short}\n\n"
            "Please reply to confirm you're available to mentor this team. If you can't, "
            "let us know so we can help the team find another mentor before the deadline.\n\n"
            "— RealHack Organizing Team"
        ),
    ),
    EmailTemplate(
        id="final_call",
        label="Final call — May 19 deadline",
        description="Last-mile reminder before the registration deadline.",
        audience="team",
        subject="RealHack 2026 — final reminder: registration closes May 19",
        body=(
            "Hi {member_first_names_or_team},\n\n"
            "Quick reminder: RealHack 2026 registration closes on May 19, 2026 and the "
            "deadline will not be extended.\n\n"
            "Your team {team_name} is currently {status_summary}.\n\n"
            "If any details still need updating, please update them today.\n\n"
            "— RealHack Organizing Team"
        ),
    ),
    EmailTemplate(
        id="channel_ready",
        label="Teams channel ready",
        description="Sent once the Teams channel for a team has been created.",
        audience="team",
        subject="RealHack 2026 — your Teams channel is live for {team_name}",
        body=(
            "Hi {member_first_names_or_team},\n\n"
            "Your private Teams channel for RealHack 2026 is now live:\n"
            "  Channel: RealHack 2026 / {team_name}\n\n"
            "Mentor and all members have been added. Please use this channel for "
            "coordination, code reviews, and any organizing-team announcements.\n\n"
            "— RealHack Organizing Team"
        ),
    ),
]


def _missing_fields(team: Team) -> list[str]:
    missing: list[str] = []
    for key, label in CRITICAL_FIELDS.items():
        val = getattr(team, key, None)
        if val is None or not str(val).strip() or str(val).strip().lower() in {"tbd", "na", "n/a", "none", "-", "pending"}:
            missing.append(label)
    return missing


def _first_names(team: Team) -> str:
    names: list[str] = []
    for m in team.members[:4]:
        first = (m.name or "").strip().split(" ")[0]
        if first:
            names.append(first)
    if not names:
        return "team"
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def _member_list(team: Team) -> str:
    if not team.members:
        return "  (no members listed)"
    lines = []
    for m in team.members:
        bits = [m.name or "—"]
        if m.email:
            bits.append(m.email)
        if m.location:
            bits.append(m.location)
        lines.append("  - " + " · ".join(bits))
    return "\n".join(lines)


def _status_summary(team: Team) -> str:
    flags = team.flags or []
    if team.completeness_score >= 0.8 and not flags:
        return "in good shape (complete with no flags)"
    bits = [f"{int(team.completeness_score * 100)}% complete"]
    if flags:
        bits.append(f"{len(flags)} screening flag{'s' if len(flags) != 1 else ''}")
    return " · ".join(bits)


def _short_idea(team: Team) -> str:
    s = (team.idea or "").strip()
    if not s:
        return "(no idea provided)"
    if len(s) > 200:
        return s[:200].rsplit(" ", 1)[0] + "…"
    return s


def render(template: EmailTemplate, team: Team) -> dict:
    """Render a template for a single team — returns dict with subject + body + recipients."""
    missing = _missing_fields(team)
    missing_block = "\n".join(f"  - {f}" for f in missing) or "  (none — submission looks complete)"

    tokens = {
        "team_name": team.name,
        "mentor_name": team.mentor_name or "(mentor not listed)",
        "member_first_names_or_team": _first_names(team) or "team",
        "member_list": _member_list(team),
        "missing_fields_block": missing_block,
        "idea_short": _short_idea(team),
        "status_summary": _status_summary(team),
    }

    def fill(s: str) -> str:
        try:
            return s.format(**tokens)
        except Exception:
            # Best-effort: fail open if a token is missing
            return s

    if template.audience == "mentor":
        to_emails = [team.mentor_email] if team.mentor_email else []
    else:
        to_emails = [m.email for m in team.members if m.email]

    return {
        "team_id": team.id,
        "team_name": team.name,
        "audience": template.audience,
        "to": [e for e in to_emails if e],
        "subject": fill(template.subject),
        "body": fill(template.body),
        "missing_fields": missing,
    }


def render_many(db: Session, template_id: str, team_ids: Iterable[int] | None = None) -> list[dict]:
    template = next((t for t in TEMPLATES if t.id == template_id), None)
    if template is None:
        raise KeyError(f"unknown template id: {template_id}")
    q = db.query(Team)
    if team_ids is not None:
        q = q.filter(Team.id.in_(list(team_ids)))
    teams = q.order_by(Team.name.asc()).all()
    return [render(template, t) for t in teams]
