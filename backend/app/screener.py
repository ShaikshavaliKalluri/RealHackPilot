"""Rules-based screening pass over imported teams.

The output of this module is what M2 (AI Screening) will eventually enrich.
For now we cover the deterministic checks the organizing team flagged:
  - completeness of critical fields
  - placeholder/low-detail content
  - duplicate participants across teams
  - mentor stretched across too many teams
  - malformed location / t-shirt size (impacts swag shipping)
"""
from __future__ import annotations

from collections import Counter, defaultdict

from sqlalchemy.orm import Session

from .models import Team, Member


CRITICAL_FIELDS = ("idea", "tools", "approach", "viability", "business_value")
MIN_FIELD_CHARS = 20
PLACEHOLDERS = {"", "tbd", "na", "n/a", "none", "-", "pending", "to be decided", "not applicable"}
VALID_LOCATIONS = {"us", "india", "philippines"}
VALID_TSHIRT = {"s", "m", "l", "xl", "xxl", "xxxl"}
MENTOR_MAX_TEAMS = 2


def _is_low_quality(value: str | None) -> bool:
    if value is None:
        return True
    s = value.strip().lower()
    if s in PLACEHOLDERS:
        return True
    return len(s) < MIN_FIELD_CHARS


def _completeness(team: Team) -> float:
    filled = sum(0 if _is_low_quality(getattr(team, f)) else 1 for f in CRITICAL_FIELDS)
    return round(filled / len(CRITICAL_FIELDS), 2)


def _team_flags(team: Team) -> list[str]:
    flags: list[str] = []
    for f in CRITICAL_FIELDS:
        if _is_low_quality(getattr(team, f)):
            flags.append(f"low_quality:{f}")

    member_count = len(team.members)
    if member_count < 3:
        flags.append(f"team_too_small:{member_count}")
    elif member_count > 5:
        flags.append(f"team_too_large:{member_count}")

    if not team.mentor_name or not str(team.mentor_name).strip():
        flags.append("missing_mentor")

    for m in team.members:
        if m.location and m.location.strip().lower() not in VALID_LOCATIONS:
            flags.append(f"bad_location:{m.name}")
        if m.tshirt_size and m.tshirt_size.strip().upper() not in {x.upper() for x in VALID_TSHIRT}:
            flags.append(f"bad_tshirt:{m.name}")

    return flags


def screen_all(db: Session) -> dict:
    """Recompute completeness & flags for every team, plus cross-team rules."""
    teams = db.query(Team).all()

    # First pass — per-team rules
    for t in teams:
        t.completeness_score = _completeness(t)
        t.flags = _team_flags(t)

    # Cross-team: duplicate participants
    participant_to_teams: dict[str, list[int]] = defaultdict(list)
    for t in teams:
        for m in t.members:
            key = m.name.strip().lower() if m.name else ""
            if key:
                participant_to_teams[key].append(t.id)

    duplicate_participants = 0
    for key, team_ids in participant_to_teams.items():
        if len(set(team_ids)) > 1:
            duplicate_participants += 1
            for t in teams:
                if t.id in team_ids:
                    flag = f"duplicate_participant:{key}"
                    if flag not in t.flags:
                        t.flags = (t.flags or []) + [flag]

    # Cross-team: mentor load
    mentor_counts: Counter[str] = Counter()
    for t in teams:
        if t.mentor_name:
            mentor_counts[t.mentor_name.strip().lower()] += 1

    multi_team_mentors = 0
    for mentor, count in mentor_counts.items():
        if count > MENTOR_MAX_TEAMS:
            multi_team_mentors += 1
            for t in teams:
                if t.mentor_name and t.mentor_name.strip().lower() == mentor:
                    flag = f"mentor_overloaded:{count}_teams"
                    if flag not in (t.flags or []):
                        t.flags = (t.flags or []) + [flag]

    db.flush()
    return {
        "teams_scanned": len(teams),
        "duplicate_participants": duplicate_participants,
        "multi_team_mentors": multi_team_mentors,
    }
