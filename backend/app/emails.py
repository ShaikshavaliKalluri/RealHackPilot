"""Deterministic email templates with per-team mail-merge.

Each template defines: id, label, description, subject, body, audience.
Tokens are simple {token} substitutions filled from the team record.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from sqlalchemy.orm import Session

from .models import Team


# CID for the inline brand logo. Templates reference it via <img src="cid:realhack-logo">.
# Senders (send_emails.py) attach the bytes returned by get_logo_attachment() to the
# Graph /sendMail payload so the image renders inline instead of as a broken external link.
LOGO_CID = "realhack-logo"

# Canonical wordmark PNG — single source of truth, owned by the frontend bundle.
_LOGO_PATH = Path(__file__).parent.parent.parent / "frontend" / "public" / "realhack-logo.png"


def get_logo_attachment() -> dict | None:
    """Graph fileAttachment dict for the inline RealHack wordmark.

    Returns None if the PNG can't be read — sender then sends the HTML without
    the attachment and the <img> tag renders as alt text rather than failing
    the whole message.
    """
    try:
        data = _LOGO_PATH.read_bytes()
    except OSError:
        return None
    return {
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": "realhack-logo.png",
        "contentType": "image/png",
        "contentId": LOGO_CID,
        "isInline": True,
        "contentBytes": base64.b64encode(data).decode("ascii"),
    }


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
    body: str           # plain-text fallback
    body_html: str = "" # rich HTML version; used when set, else body is sent as text


# ---- HTML branded wrapper ----
def _html_wrap(content: str) -> str:
    """Wrap a content HTML snippet in the RealHack branded email shell.

    Header uses the official wordmark via CID (<img src="cid:realhack-logo">).
    Background is white because the wordmark is bright blue — a blue header
    would hide it. A thin blue accent line below the logo preserves the
    brand-color signal.
    """
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {{margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,Segoe UI,Arial,sans-serif;}}
    .wrap {{max-width:600px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);}}
    .hdr {{background:#ffffff;padding:24px 32px 18px;border-bottom:3px solid #0078d4;}}
    .hdr img {{display:block;height:42px;width:auto;margin-bottom:8px;}}
    .hdr p {{color:#5b6b7c;margin:0;font-size:12px;letter-spacing:.2px;}}
    .bdy {{padding:28px 32px;color:#222;font-size:15px;line-height:1.65;}}
    .bdy p {{margin:0 0 14px;}}
    .bdy ul {{margin:8px 0 14px;padding-left:22px;}}
    .bdy li {{margin:4px 0;}}
    .bdy .label {{font-weight:600;color:#333;}}
    .bdy .info-block {{background:#f4f8fd;border-left:3px solid #0078d4;border-radius:4px;padding:12px 16px;margin:14px 0;font-size:14px;}}
    .bdy .fields {{background:#fff8f0;border-left:3px solid #e67e00;border-radius:4px;padding:12px 16px;margin:14px 0;font-size:14px;}}
    .ftr {{background:#f8f8f8;padding:14px 32px;color:#999;font-size:12px;border-top:1px solid #eee;}}
    .ftr a {{color:#0078d4;text-decoration:none;}}
    a {{color:#0078d4;}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr">
      <img src="cid:{LOGO_CID}" alt="RealHack 2026">
      <p>June 18–19 &nbsp;·&nbsp; RealPage Internal Hackathon</p>
    </div>
    <div class="bdy">
{content}
    </div>
    <div class="ftr">
      RealHack Organizing Team &nbsp;·&nbsp;
      <a href="mailto:RealHack@realpage.com">RealHack@realpage.com</a>
    </div>
  </div>
</body>
</html>"""


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
        body_html=_html_wrap(
            "      <p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "      <p>You're confirmed for <strong>RealHack 2026</strong> (June 18–19). Here's your registration summary:</p>\n"
            "      <div class='info-block'>\n"
            "        <p class='label'>Team &nbsp;·&nbsp; {team_name}</p>\n"
            "        <p><span class='label'>Mentor:</span> {mentor_name}</p>\n"
            "        <p><span class='label'>Members:</span><br>{member_list}</p>\n"
            "        <p><span class='label'>Idea on file:</span> {idea_short}</p>\n"
            "      </div>\n"
            "      <p><strong>Next steps:</strong></p>\n"
            "      <ul>\n"
            "        <li>Your private Teams channel will be created in the next few days.</li>\n"
            "        <li>Watch your inbox for the kickoff and schedule details.</li>\n"
            "        <li>Your mentor will reach out to align before the event.</li>\n"
            "      </ul>\n"
            "      <p>If anything above looks wrong, reply to "
            "<a href='mailto:RealHack@realpage.com'>RealHack@realpage.com</a>.</p>"
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
        body_html=_html_wrap(
            "      <p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "      <p>Thanks for registering team <strong>{team_name}</strong> for RealHack 2026.</p>\n"
            "      <p>When we reviewed your submission, the following field(s) were either "
            "empty, marked TBD, or too brief to evaluate:</p>\n"
            "      <div class='fields'>{missing_fields_block}</div>\n"
            "      <p>Could you update the registration with a more detailed answer for each "
            "of the above? <strong>The deadline is May 19, 2026 and will not be extended.</strong></p>\n"
            "      <p>If you're unsure what to write or want to discuss the idea, your mentor "
            "<strong>{mentor_name}</strong> is available to help.</p>"
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
        body_html=_html_wrap(
            "      <p>Hi <strong>{mentor_name}</strong>,</p>\n"
            "      <p>Team <strong>{team_name}</strong> listed you as their mentor for RealHack 2026 (June 18–19).</p>\n"
            "      <div class='info-block'>\n"
            "        <p class='label'>Team members:</p>\n"
            "        <p>{member_list}</p>\n"
            "        <p class='label'>Idea on file:</p>\n"
            "        <p>{idea_short}</p>\n"
            "      </div>\n"
            "      <p>Please reply to confirm you're available to mentor this team. If you can't, "
            "let us know so we can help the team find another mentor before the deadline.</p>"
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
        body_html=_html_wrap(
            "      <p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "      <p>Quick reminder: <strong>RealHack 2026 registration closes on May 19, 2026</strong> "
            "and the deadline will not be extended.</p>\n"
            "      <div class='info-block'>\n"
            "        <p class='label'>Status for team {team_name}:</p>\n"
            "        <p>{status_summary}</p>\n"
            "      </div>\n"
            "      <p>If any details still need updating, please update them today.</p>"
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
        body_html=_html_wrap(
            "      <p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "      <p>Your private Teams channel for RealHack 2026 is now live.</p>\n"
            "      <div class='info-block'>\n"
            "        <p class='label'>Channel name</p>\n"
            "        <p>2026 Team - {team_name}</p>\n"
            "        <p class='label'>Members added</p>\n"
            "        <p>Your mentor and all team members have already been added.</p>\n"
            "      </div>\n"
            "      <p>Use this channel for coordination, code reviews, and any "
            "organizing-team announcements.</p>"
        ),
    ),
    EmailTemplate(
        id="individual_participation",
        label="Individual participation — for people without a team or idea",
        description=(
            "Sent to RealPage employees who reached out about participating but don't "
            "have a team or a problem statement yet. Points them to the individual "
            "registration link and sets expectations about team matchmaking."
        ),
        # Audience is intentionally 'team' so the same composer flow renders it.
        # Recipient list is the team members on the selected row(s); the message
        # body itself is generic enough to read well even if forwarded to individuals.
        audience="team",
        subject="RealHack 2026 — individual participation: how to proceed",
        body=(
            "Hi {member_first_names_or_team},\n\n"
            "Thank you for your interest in participating in RealHack 2026!\n\n"
            "If you're interested but don't currently have a problem statement, idea, "
            "or team, you can still register as an individual.\n\n"
            "Here's how to proceed:\n\n"
            "Please click on the Individual Registration link: "
            "<INSERT_INDIVIDUAL_REGISTRATION_LINK_HERE>\n\n"
            "Then follow whichever option applies to you:\n\n"
            "  • If you already have an idea:\n"
            "    Complete the Idea section in the registration form along with the "
            "required basic details.\n\n"
            "  • If you'd like to participate but don't have an idea or a team:\n"
            "    Fill in only the basic registration details (the first section of "
            "the form).\n\n"
            "The organizing committee will make every effort to help place individual "
            "registrants into teams based on the information provided. However, please "
            "note that team allocation and participation cannot be guaranteed.\n\n"
            "If you have any questions, feel free to reach out. We look forward to "
            "your participation in RealHack 2026!\n\n"
            "Thanks,\n"
            "RealHack Team"
        ),
        body_html=_html_wrap(
            "      <p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "      <p>Thank you for your interest in participating in <strong>RealHack 2026</strong>!</p>\n"
            "      <p>If you're interested but don't currently have a <strong>problem statement, idea, "
            "or team</strong>, you can still register as an individual.</p>\n"
            "      <p><strong>Here's how to proceed:</strong></p>\n"
            "      <p>Please click on the Individual Registration link: "
            "<a href='&lt;INSERT_INDIVIDUAL_REGISTRATION_LINK_HERE&gt;'>Individual Registration</a></p>\n"
            "      <p><strong>Then follow whichever option applies to you:</strong></p>\n"
            "      <ul>\n"
            "        <li><strong>If you already have an idea:</strong> Complete the Idea section "
            "in the registration form along with the required basic details.</li>\n"
            "        <li><strong>If you'd like to participate but don't have an idea or a team:</strong> "
            "Fill in only the basic registration details (the first section of the form).</li>\n"
            "      </ul>\n"
            "      <p>The organizing committee will make every effort to help place individual "
            "registrants into teams based on the information provided. However, please note that "
            "<strong>team allocation and participation cannot be guaranteed</strong>.</p>\n"
            "      <p>If you have any questions, feel free to reach out. We look forward to your "
            "participation in RealHack 2026!</p>"
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
        "body_html": fill(template.body_html) if template.body_html else None,
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
