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
    archived: bool = False  # hidden from the composer UI; kept in source for revival next year


# ---- HTML branded wrapper ----
def _html_wrap(content: str) -> str:
    """Wrap a content HTML snippet in the RealHack branded email shell.

    Header uses the official wordmark via CID (<img src="cid:realhack-logo">).
    Background is white because the wordmark is bright blue — a blue header
    would hide it. A thin blue accent line below the logo preserves the
    brand-color signal.
    """
    # The template uses table-based layout for Outlook compatibility (CSS
    # grid/flex don't render in Outlook desktop). Styles live in <style> AND
    # inline on critical elements as a fallback. The CSS curly braces are
    # left as single-brace because we no longer use str.format() at render
    # time — emails.fill() uses str.replace() per-token now.
    # Outlook desktop ignores `background:linear-gradient(...)` and the CSS
    # `filter` property, so the previous gradient hero ended up rendering as
    # plain white with the blue logo on white + invisible white text. Now we
    # use a SOLID dark-blue hero (bgcolor + inline style — both belt and
    # suspenders for Outlook) and a white wordmark image-on-blue, no CSS
    # filter required.
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>RealHack 2026</title>
  <style>
    body { margin:0; padding:0; background:#eef1f5; font-family:'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif; -webkit-font-smoothing:antialiased; }
    table { border-collapse:collapse; }
    a { color:#0078d4; text-decoration:none; }
    .body-pad { padding:32px 36px 8px; color:#2a2f36; font-size:15px; line-height:1.65; }
    .body-pad p { margin:0 0 14px; }
    .body-pad ul { margin:8px 0 16px; padding-left:22px; }
    .body-pad li { margin:6px 0; }
    .body-pad strong { color:#1a1f26; }
    .body-pad h2 { color:#0a4f99; font-size:18px; margin:24px 0 10px; font-weight:700; }
    @media (max-width:600px) {
      .body-pad { padding:24px 22px 6px; font-size:14.5px; }
      .hero-pad { padding:28px 20px !important; }
      .info-pad { padding:14px 16px !important; }
      .footer-pad { padding:18px 22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef1f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f5;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(10,79,153,0.10);">
        <!-- ===== Brand row (white, logo gets the breathing room) ===== -->
        <tr><td bgcolor="#ffffff" align="center" style="background-color:#ffffff;padding:40px 32px 12px;text-align:center;">
          <img src="cid:""" + LOGO_CID + """" alt="RealHack 2026" width="300" style="display:block;margin:0 auto;height:auto;max-height:80px;">
          <p style="color:#5b6b7c;margin:14px 0 0;font-size:12px;letter-spacing:.5px;text-transform:uppercase;font-weight:600;">
            Innovate &nbsp;&middot;&nbsp; Build &nbsp;&middot;&nbsp; Win
          </p>
        </td></tr>
        <!-- ===== Slim event-info strip (two-line: tagline + dates) ===== -->
        <tr><td bgcolor="#0a4f99" align="center" style="background-color:#0a4f99;padding:11px 32px 12px;text-align:center;border-top:2px solid #29b6f6;">
          <p style="color:#ffffff;margin:0 0 2px;font-size:12px;letter-spacing:.5px;text-transform:uppercase;font-weight:700;">
            A RealPage Hackathon
          </p>
          <p style="color:#dbe9f7;margin:0;font-size:11px;letter-spacing:.5px;font-weight:600;">
            June 18&ndash;19, 2026
          </p>
        </td></tr>
        <!-- ===== Body ===== -->
        <tr><td class="body-pad">
""" + content + """
        </td></tr>
        <!-- ===== Footer ===== -->
        <tr><td class="footer-pad" bgcolor="#f4f6f9" style="background-color:#f4f6f9;padding:22px 36px;border-top:1px solid #e5e9ef;color:#6b7280;font-size:12px;line-height:1.6;text-align:center;">
          <p style="margin:0 0 6px;color:#0a4f99;font-weight:700;">RealHack Organizing Team</p>
          <p style="margin:0;"><a href="mailto:RealHack@realpage.com" style="color:#0078d4;">RealHack@realpage.com</a></p>
          <p style="margin:10px 0 0;color:#9ca3af;font-size:11px;">&copy; 2026 RealPage, Inc.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


TEMPLATES: list[EmailTemplate] = [
    EmailTemplate(
        id="welcome",
        label="Welcome — registration confirmed",
        description="Sent to team members right after a clean registration.",
        audience="team",
        subject="Welcome to RealHack 2026 — Team {team_name}",
        body=(
            "Hi {team_name} team,\n\n"
            "Your team registration is confirmed for RealHack 2026 (June 18–19). Below is the team summary.\n\n"
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
            "<p>Hi <strong>{team_name}</strong> team,</p>\n"
            "<p>Your team registration is confirmed for <strong>RealHack 2026</strong>. Below is the team summary.</p>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%' style='margin:18px 0;background:#f4f8fd;border-radius:8px;border-left:4px solid #0078d4;'>\n"
            "<tr><td class='info-pad' style='padding:18px 22px;'>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%'>\n"
            "  <tr><td style='padding-bottom:14px;'>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Team</div>\n"
            "    <div style='color:#1a1f26;font-size:15px;font-weight:700;'>{team_name}</div>\n"
            "  </td></tr>\n"
            "  <tr><td style='padding-bottom:14px;'>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Mentor</div>\n"
            "    <div style='color:#1a1f26;font-size:14px;'>{mentor_name}</div>\n"
            "  </td></tr>\n"
            "  <tr><td style='padding-bottom:14px;'>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Members</div>\n"
            "    <div style='color:#1a1f26;font-size:14px;'>{member_list_html}</div>\n"
            "  </td></tr>\n"
            "  <tr><td>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Idea on file</div>\n"
            "    <div style='color:#1a1f26;font-size:14px;line-height:1.55;text-align:justify;'>{idea_full}</div>\n"
            "  </td></tr>\n"
            "</table>\n"
            "</td></tr>\n"
            "</table>\n"
            "<h2>What happens next</h2>\n"
            "<ul>\n"
            "  <li>A private <strong>Microsoft Teams channel</strong> will be set up for your team in the next few days.</li>\n"
            "  <li>Watch your inbox for the <strong>kickoff message</strong> and event-day schedule.</li>\n"
            "  <li>Your <strong>mentor will reach out</strong> to align on the problem statement before the event.</li>\n"
            "</ul>\n"
            "<p>Questions or corrections? Reply to this thread or write to <a href='mailto:RealHack@realpage.com'>RealHack@realpage.com</a>.</p>\n"
            "<p style='margin-top:22px;'>See you on <strong>June 18&ndash;19</strong>!<br>\n"
            "<span style='color:#0a4f99;font-weight:700;'>— The RealHack Organizing Team</span></p>"
        ),
    ),
    EmailTemplate(
        id="fix_it",
        label="Fix-it — incomplete submission",
        description="Sent to teams whose submission is missing or vague in critical fields.",
        audience="team",
        subject="Action needed — complete your RealHack 2026 submission for Team {team_name}",
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
            "<p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "<p>Thanks for registering Team <strong>{team_name}</strong> for RealHack 2026. When we reviewed your submission, the following fields were either empty, marked TBD, or too brief to evaluate:</p>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%' style='margin:18px 0;background:#fff8eb;border-radius:8px;border-left:4px solid #f59e00;'>\n"
            "<tr><td class='info-pad' style='padding:18px 22px;'>\n"
            "  <div style='font-weight:700;color:#b8590a;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;'>Needs your attention</div>\n"
            "  <div style='color:#1a1f26;font-size:14px;line-height:1.7;white-space:pre-line;'>{missing_fields_block}</div>\n"
            "</td></tr>\n"
            "</table>\n"
            "<p>Please update the registration with a more detailed answer for each item above. <strong>The deadline is May 19, 2026 and will not be extended.</strong></p>\n"
            "<p>If you're unsure what to write or want to discuss the idea, your mentor <strong>{mentor_name}</strong> is available to help.</p>\n"
            "<p style='margin-top:22px;'><span style='color:#0a4f99;font-weight:700;'>— The RealHack Organizing Team</span></p>"
        ),
    ),
    EmailTemplate(
        archived=True,  # not used in 2026 — kept for potential revival next year
        id="mentor_confirm",
        label="Mentor — please confirm your teams",
        description="Sent to mentors to verify their team assignment.",
        audience="mentor",
        subject="Please confirm — you're the mentor for Team {team_name} at RealHack 2026",
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
            "<p>Hi <strong>{mentor_name}</strong>,</p>\n"
            "<p>Team <strong>{team_name}</strong> listed you as their mentor for RealHack 2026. Here's the team you'd be mentoring:</p>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%' style='margin:18px 0;background:#f4f8fd;border-radius:8px;border-left:4px solid #0078d4;'>\n"
            "<tr><td class='info-pad' style='padding:18px 22px;'>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%'>\n"
            "  <tr><td style='padding-bottom:14px;'>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Team</div>\n"
            "    <div style='color:#1a1f26;font-size:15px;font-weight:700;'>{team_name}</div>\n"
            "  </td></tr>\n"
            "  <tr><td style='padding-bottom:14px;'>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Members</div>\n"
            "    <div style='color:#1a1f26;font-size:14px;'>{member_list_html}</div>\n"
            "  </td></tr>\n"
            "  <tr><td>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Idea on file</div>\n"
            "    <div style='color:#1a1f26;font-size:14px;line-height:1.55;text-align:justify;'>{idea_full}</div>\n"
            "  </td></tr>\n"
            "</table>\n"
            "</td></tr>\n"
            "</table>\n"
            "<p><strong>Please reply to confirm you're available to mentor this team.</strong> If you can't, let us know so we can help the team find another mentor before the deadline.</p>\n"
            "<p style='margin-top:22px;'>Thanks for supporting RealHack 2026.<br>\n"
            "<span style='color:#0a4f99;font-weight:700;'>— The RealHack Organizing Team</span></p>"
        ),
    ),
    EmailTemplate(
        archived=True,  # registration closed May 19 — not relevant anymore
        id="final_call",
        label="Final call — May 19 deadline",
        description="Last-mile reminder before the registration deadline.",
        audience="team",
        subject="Final reminder — RealHack 2026 registration closes May 19",
        body=(
            "Hi {member_first_names_or_team},\n\n"
            "Quick reminder: RealHack 2026 registration closes on May 19, 2026 and the "
            "deadline will not be extended.\n\n"
            "Your team {team_name} is currently {status_summary}.\n\n"
            "If any details still need updating, please update them today.\n\n"
            "— RealHack Organizing Team"
        ),
        body_html=_html_wrap(
            "<p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "<p>Quick reminder: <strong>RealHack 2026 registration closes on May 19, 2026</strong> and the deadline will not be extended.</p>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%' style='margin:18px 0;background:#f4f8fd;border-radius:8px;border-left:4px solid #0078d4;'>\n"
            "<tr><td class='info-pad' style='padding:18px 22px;'>\n"
            "  <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Status for Team {team_name}</div>\n"
            "  <div style='color:#1a1f26;font-size:14px;line-height:1.55;'>{status_summary}</div>\n"
            "</td></tr>\n"
            "</table>\n"
            "<p>If any details still need updating, please update them today.</p>\n"
            "<p style='margin-top:22px;'>See you on <strong>June 18&ndash;19</strong>.<br>\n"
            "<span style='color:#0a4f99;font-weight:700;'>— The RealHack Organizing Team</span></p>"
        ),
    ),
    EmailTemplate(
        id="channel_ready",
        label="Teams channel ready",
        description="Sent once the Teams channel for a team has been created.",
        audience="team",
        subject="Your RealHack 2026 Teams channel is live — Team {team_name}",
        body=(
            "Hi {member_first_names_or_team},\n\n"
            "Your Teams channel for RealHack 2026 is now live:\n"
            "  Channel: 2026 Team - {team_name}\n"
            "  Open: {teams_channel_url}\n\n"
            "Mentor and all members have been added. Please use this channel for "
            "coordination, code reviews, and any organizing-team announcements.\n\n"
            "— RealHack Organizing Team"
        ),
        body_html=_html_wrap(
            "<p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "<p>Your Microsoft Teams channel for <strong>RealHack 2026</strong> is now live and ready for the team.</p>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%' style='margin:18px 0;background:#f4f8fd;border-radius:8px;border-left:4px solid #0078d4;'>\n"
            "<tr><td class='info-pad' style='padding:18px 22px;'>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%'>\n"
            "  <tr><td style='padding-bottom:14px;'>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Channel name</div>\n"
            "    <div style='color:#1a1f26;font-size:15px;font-weight:700;'>2026 Team - {team_name}</div>\n"
            "  </td></tr>\n"
            "  <tr><td>\n"
            "    <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;'>Members added</div>\n"
            "    <div style='color:#1a1f26;font-size:14px;'>Your mentor and all team members have already been added.</div>\n"
            "  </td></tr>\n"
            "</table>\n"
            "</td></tr>\n"
            "</table>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' style='margin:6px auto 22px;'><tr>\n"
            "  <td bgcolor='#0078d4' style='background-color:#0078d4;border-radius:6px;'>\n"
            "    <a href='{teams_channel_url}' style='display:inline-block;padding:13px 26px;color:#ffffff;font-weight:700;font-size:14px;letter-spacing:.3px;text-decoration:none;'>Open in Microsoft Teams &rarr;</a>\n"
            "  </td>\n"
            "</tr></table>\n"
            "<h2>What to use it for</h2>\n"
            "<ul>\n"
            "  <li>Coordination, planning, and quick syncs with your team</li>\n"
            "  <li>Code reviews and link-sharing for your repo</li>\n"
            "  <li>Catching organizing-team announcements during the event</li>\n"
            "</ul>\n"
            "<p style='margin-top:22px;'>See you on <strong>June 18&ndash;19</strong>.<br>\n"
            "<span style='color:#0a4f99;font-weight:700;'>— The RealHack Organizing Team</span></p>"
        ),
    ),
    EmailTemplate(
        archived=True,  # registration closed — individual sign-up flow not relevant anymore
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
            "<p>Hi <strong>{member_first_names_or_team}</strong>,</p>\n"
            "<p>Thank you for your interest in participating in <strong>RealHack 2026</strong>! If you don't currently have a problem statement, idea, or team, you can still register as an individual and we'll try to match you with a team.</p>\n"
            "<h2>How to register</h2>\n"
            "<p>Click the Individual Registration link: <a href='&lt;INSERT_INDIVIDUAL_REGISTRATION_LINK_HERE&gt;'><strong>Individual Registration</strong></a></p>\n"
            "<p>Then follow whichever option applies to you:</p>\n"
            "<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='100%' style='margin:18px 0;background:#f4f8fd;border-radius:8px;border-left:4px solid #0078d4;'>\n"
            "<tr><td class='info-pad' style='padding:18px 22px;'>\n"
            "  <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;'>If you already have an idea</div>\n"
            "  <div style='color:#1a1f26;font-size:14px;line-height:1.55;margin-bottom:14px;'>Complete the Idea section in the registration form along with the required basic details.</div>\n"
            "  <div style='font-weight:700;color:#0a4f99;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;'>If you don't have an idea or a team</div>\n"
            "  <div style='color:#1a1f26;font-size:14px;line-height:1.55;'>Fill in only the basic registration details (the first section of the form).</div>\n"
            "</td></tr>\n"
            "</table>\n"
            "<p>The organizing committee will make every effort to place individual registrants into teams based on the information provided. Please note that <strong>team allocation and participation cannot be guaranteed</strong>.</p>\n"
            "<p>Questions? Reply to this thread or write to <a href='mailto:RealHack@realpage.com'>RealHack@realpage.com</a>. We look forward to your participation in RealHack 2026.</p>\n"
            "<p style='margin-top:22px;'><span style='color:#0a4f99;font-weight:700;'>— The RealHack Organizing Team</span></p>"
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


def _proper_case(name: str | None) -> str:
    """Normalize a person's name to Title Case regardless of how it was typed
    in the form. RealPage's MS Forms export has a mix of ALL CAPS, lowercase,
    and Title Case names from different registrants — emails should read
    uniformly to a recipient so we normalize on render. Uses .title() which
    handles apostrophes and hyphens correctly for typical names.
    """
    if not name:
        return ""
    return name.strip().title()


def _teams_channel_url(team: Team) -> str:
    """Build a deeplink that opens the team's Teams channel directly in the
    Microsoft Teams client (desktop) or Teams web. Returns an empty string
    when there's no channel yet or the parent-team / tenant config is missing
    (e.g. in sandbox/Test Mode where Graph isn't called).

    Format reference: https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-links
    """
    import os
    import urllib.parse as _urlparse
    if not team.has_teams_channel or not team.teams_channel_id:
        return ""
    parent = os.environ.get("GRAPH_PARENT_TEAM_ID", "")
    tenant = os.environ.get("AZURE_TENANT_ID", "")
    if not parent or not tenant:
        return ""
    # Sandbox channels start with 'sandbox-channel-' — no real Teams deeplink.
    if team.teams_channel_id.startswith(("sandbox-", "mock-", "dryrun-")):
        return ""
    channel_id_enc = _urlparse.quote(team.teams_channel_id, safe="")
    channel_name_enc = _urlparse.quote(f"2026 Team - {team.name}", safe="")
    return (
        f"https://teams.microsoft.com/l/channel/{channel_id_enc}/{channel_name_enc}"
        f"?groupId={parent}&tenantId={tenant}"
    )


def _first_names(team: Team) -> str:
    names: list[str] = []
    for m in team.members[:4]:
        first = (m.name or "").strip().split(" ")[0]
        if first:
            names.append(_proper_case(first))
    if not names:
        return "team"
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def _member_list(team: Team) -> str:
    """Plain-text member list — used in `body` (the .txt fallback). Keeps the
    detailed format with name · email · country so org leads can see contact
    info at a glance when reading the text version. Name normalized to
    Title Case so 'DEEPTHI DINGARI' and 'srinivas chilakamarri' render as
    'Deepthi Dingari' and 'Srinivas Chilakamarri'."""
    if not team.members:
        return "  (no members listed)"
    lines = []
    for m in team.members:
        bits = [_proper_case(m.name) or "—"]
        if m.email:
            bits.append(m.email)
        if m.location:
            bits.append(m.location)
        lines.append("  - " + " · ".join(bits))
    return "\n".join(lines)


def _member_list_html(team: Team) -> str:
    """HTML member list — names only, one per line, Title-Cased. Cleaner for
    the branded email."""
    if not team.members:
        return "<em style='color:#6b7280;'>No members listed yet</em>"
    items = []
    for m in team.members:
        name = _proper_case(m.name) or "—"
        items.append(
            "<div style='padding:6px 0;border-bottom:1px solid #e5e9ef;'>"
            f"<span style='color:#1a1f26;'>{name}</span>"
            "</div>"
        )
    # Last row shouldn't have a bottom border for a cleaner look
    if items:
        items[-1] = items[-1].replace(
            ";border-bottom:1px solid #e5e9ef;", ";"
        )
    return "".join(items)


def _status_summary(team: Team) -> str:
    flags = team.flags or []
    if team.completeness_score >= 0.8 and not flags:
        return "in good shape (complete with no flags)"
    bits = [f"{int(team.completeness_score * 100)}% complete"]
    if flags:
        bits.append(f"{len(flags)} screening flag{'s' if len(flags) != 1 else ''}")
    return " · ".join(bits)


def _short_idea(team: Team) -> str:
    """Trimmed idea for the plain-text body — keeps the .txt fallback short."""
    s = (team.idea or "").strip()
    if not s:
        return "(no idea provided)"
    if len(s) > 200:
        return s[:200].rsplit(" ", 1)[0] + "…"
    return s


def _full_idea(team: Team) -> str:
    """Full idea text for the HTML body — no truncation. The HTML wraps and
    the recipient should see the whole thing, not a teaser ending in '…'."""
    s = (team.idea or "").strip()
    return s if s else "(no idea provided)"


def render(template: EmailTemplate, team: Team) -> dict:
    """Render a template for a single team — returns dict with subject + body + recipients."""
    missing = _missing_fields(team)
    missing_block = "\n".join(f"  - {f}" for f in missing) or "  (none — submission looks complete)"

    tokens = {
        "team_name": team.name,
        "mentor_name": _proper_case(team.mentor_name) or "(mentor not listed)",
        "member_first_names_or_team": _first_names(team) or "team",
        "member_list": _member_list(team),               # plain text: name · email · country
        "member_list_html": _member_list_html(team),     # html: names only, one per line
        "missing_fields_block": missing_block,
        "idea_short": _short_idea(team),                 # plain text: 200-char teaser
        "idea_full": _full_idea(team),                   # html: full idea text
        "status_summary": _status_summary(team),
        "teams_channel_url": _teams_channel_url(team),   # Teams deeplink (empty if no channel yet)
    }

    def fill(s: str) -> str:
        # str.replace per token instead of str.format(**tokens) — the HTML
        # templates contain inline CSS like `body {margin:0; ...}` whose curly
        # braces look like format-spec markers to str.format() and cause the
        # whole substitution to throw (then silently return the unrendered
        # string with literal {team_name} etc. visible in the email).
        result = s
        for key, value in tokens.items():
            result = result.replace("{" + key + "}", str(value))
        return result

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
