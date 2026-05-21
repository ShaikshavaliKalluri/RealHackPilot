"""Rules-based screening pass over imported teams.

The output of this module is what M2 (AI Screening) will eventually enrich.
For now we cover the deterministic checks the organizing team flagged:
  - completeness of critical fields
  - placeholder/low-detail content
  - duplicate participants across teams
  - mentor stretched across too many teams
  - malformed location / t-shirt size (impacts swag shipping)
  - team name accidentally set to a member's name (form-fill confusion)
  - suspicious-looking email addresses that likely won't resolve in AD
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from sqlalchemy.orm import Session

from .models import Team, Member


CRITICAL_FIELDS = ("idea", "tools", "approach", "viability", "business_value")
MIN_FIELD_CHARS = 20
PLACEHOLDERS = {"", "tbd", "na", "n/a", "none", "-", "pending", "to be decided", "not applicable"}
VALID_LOCATIONS = {"us", "india", "philippines", "canada", "uk", "romania", "mexico"}
VALID_TSHIRT = {"s", "m", "l", "xl", "xxl", "xxxl"}
MENTOR_MAX_TEAMS = 2

# Email-shape rules. We don't try to enforce strict RFC 5322 — we just catch
# the patterns that empirically don't resolve in RealPage's AD:
#   - VRAJKUMAR@RealPage.com   (no dot, all uppercase)
#   - RRishitha@RealPage.com   (no dot, single-cap prefix)
#   - SMahamkali@RealPage.com  (no dot, initial+lastname)
#   - Subba.Sai.Sireesha.Sakshi@... (>2 dots, almost always typo)
# The canonical RealPage format is `first.last@realpage.com`.
_EMAIL_BASIC = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_REALPAGE_DOMAIN = re.compile(r"@realpage\.com$", re.IGNORECASE)


def _is_low_quality(value: str | None) -> bool:
    if value is None:
        return True
    s = value.strip().lower()
    if s in PLACEHOLDERS:
        return True
    return len(s) < MIN_FIELD_CHARS


def _normalize(s: str | None) -> str:
    """Lowercase + collapse internal whitespace for fuzzy equality checks."""
    if not s:
        return ""
    return " ".join(s.strip().lower().split())


def _normalize_compact(s: str | None) -> str:
    """Lowercase + remove ALL whitespace. Catches cases like
    'Shashi Tej Reddy' (team) vs 'Shashitejreddy Singareddy' (member) where
    the same name is written with different spacing."""
    if not s:
        return ""
    return "".join(s.strip().lower().split())


def _email_issue(email: str | None) -> str | None:
    """Return None if the email looks fine; otherwise return a short reason.

    We deliberately only flag truly malformed addresses or wrong-domain ones.
    Earlier versions also flagged "no first.last separator" and "too many dots"
    as suspicious, but real-world RealPage AD has legitimate single-cap+
    lowercase aliases (e.g. PPendekanti@RealPage.com) that share the same
    shape as common typos (e.g. RRishitha@RealPage.com which doesn't resolve).
    Format alone can't distinguish them — only Microsoft Graph can. Genuinely
    unresolvable emails surface during channel provisioning's dry-run instead.
    """
    if not email:
        return None
    addr = email.strip()
    if not _EMAIL_BASIC.match(addr):
        return "malformed"
    if not _REALPAGE_DOMAIN.search(addr):
        return "non_realpage_domain"
    return None


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

    # Team-name-is-a-member-name: when filling the form, registrants sometimes
    # paste a person's name into the team-name field by mistake. Two passes:
    #   1) normalized (preserves single-space separators) — catches exact and
    #      substring matches where formatting is consistent.
    #   2) compact (all whitespace removed) — catches cases like
    #      'Shashi Tej Reddy' (team) vs 'Shashitejreddy Singareddy' (member).
    # We require min 6 chars on the compact check so very short team names
    # ('AI', 'BI', etc.) don't false-positive against random member names.
    team_name_norm = _normalize(team.name)
    team_name_compact = _normalize_compact(team.name)
    if team_name_norm:
        for m in team.members:
            mname_norm = _normalize(m.name)
            mname_compact = _normalize_compact(m.name)
            if not mname_norm:
                continue
            matches = (
                team_name_norm == mname_norm
                or team_name_norm in mname_norm
                or mname_norm in team_name_norm
                or (
                    len(team_name_compact) >= 6 and len(mname_compact) >= 6 and (
                        team_name_compact == mname_compact
                        or team_name_compact in mname_compact
                        or mname_compact in team_name_compact
                    )
                )
            )
            if matches:
                flags.append(f"team_name_is_member:{m.name}")
                break  # one is enough

    # Suspicious-looking member emails (likely Graph-unresolvable)
    for m in team.members:
        issue = _email_issue(m.email)
        if issue:
            flags.append(f"bad_email:{issue}:{m.email or m.name}")
        if m.location and m.location.strip().lower() not in VALID_LOCATIONS:
            flags.append(f"bad_location:{m.name}")
        if m.tshirt_size and m.tshirt_size.strip().upper() not in {x.upper() for x in VALID_TSHIRT}:
            flags.append(f"bad_tshirt:{m.name}")

    # Mentor email too
    if team.mentor_email:
        issue = _email_issue(team.mentor_email)
        if issue:
            flags.append(f"bad_mentor_email:{issue}:{team.mentor_email}")

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
