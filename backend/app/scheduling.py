"""Per-panel judging-day scheduling + iCalendar (.ics) invite builder.

The frontend hits `GET /api/panels/{id}/invite.ics?day=1|2` and gets back a
`.ics` file. When the organizer double-clicks it, Outlook opens a new meeting
in compose mode with attendees, schedule, and timing already filled in — they
review and click Send. No Graph API calls; the actual invite is sent from the
organizer's own Outlook.

Slot rules:
  - 15-min slots, 9:00-17:00 IST, 13:00-14:00 lunch (skipped)
  - 28 slots available per day (16 morning + 12 afternoon)
  - Teams sorted US-affiliated first (US members or US mentor), then alphabetical
  - First half of sorted teams -> Day 1, second half -> Day 2

Behavior is conservative: if a panel has more teams than available slots, the
endpoint raises 400 explaining the overflow so the organizer can split or
shorten slots before sending.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy.orm import Session

from . import models


# ---- Event constants ----

# RealHack 2026: June 18 (Thu) and June 19 (Fri), 9:00-17:00 IST, lunch 13:00-14:00.
EVENT_DATES = {
    1: (2026, 6, 18),
    2: (2026, 6, 19),
}
WORK_START = (9, 0)
WORK_END = (17, 0)
LUNCH_START = (13, 0)
LUNCH_END = (14, 0)
SLOT_MINUTES = 15

# Asia/Kolkata is UTC+5:30 year-round (no DST). Windows Outlook recognizes
# the "India Standard Time" TZID natively, which is what we use below.
IST_TZID = "India Standard Time"
IST_OFFSET = timedelta(hours=5, minutes=30)

# Organizers get the invite as Optional attendees so they can be removed by
# the sender if needed but are CC'd by default. Order kept as the user wrote
# them — RealHack mailbox first, then the three named organizers.
ORGANIZER_CC_EMAILS = [
    "realhack@realpage.com",
    "bhaskar.jaddu@RealPage.com",
    "Suneel.Nallu@RealPage.com",
    "Parshan.Uday@RealPage.com",
]


# ---- US-affiliation detection ----

# Canonical US strings (lowercased). Anything else -> not US.
_US_LOCATION_TOKENS = {"us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"}


def _is_us_location(raw: str | None) -> bool:
    if not raw:
        return False
    return raw.strip().lower() in _US_LOCATION_TOKENS


def is_us_team(team: models.Team) -> bool:
    """A team is 'US-affiliated' if its mentor or any member is in the US.

    Used to prioritize earlier slots for these teams — 9-12 IST overlaps
    late evening US time, which is more humane than 14-17 IST (US small
    hours).
    """
    if _is_us_location(team.mentor_location):
        return True
    for m in team.members:
        if _is_us_location(m.location):
            return True
    return False


# ---- Schedule generation ----

def _sort_teams(teams: list[models.Team]) -> list[models.Team]:
    """Sort: US-affiliated first, then alphabetical by team name within each group."""
    return sorted(teams, key=lambda t: (0 if is_us_team(t) else 1, t.name.lower()))


def _split_for_days(teams: list[models.Team]) -> tuple[list[models.Team], list[models.Team]]:
    """First half -> Day 1, second half -> Day 2. Already sorted with US-first,
    so this naturally puts US-affiliated teams on Day 1 (earlier slots there too)."""
    half = (len(teams) + 1) // 2  # Day 1 gets the extra if odd count
    return teams[:half], teams[half:]


def _generate_slot_starts(date: datetime) -> list[datetime]:
    """Yield slot start times for one day, skipping the lunch hour."""
    starts: list[datetime] = []
    day_start = date.replace(hour=WORK_START[0], minute=WORK_START[1], second=0, microsecond=0)
    day_end = date.replace(hour=WORK_END[0], minute=WORK_END[1], second=0, microsecond=0)
    lunch_start = date.replace(hour=LUNCH_START[0], minute=LUNCH_START[1], second=0, microsecond=0)
    lunch_end = date.replace(hour=LUNCH_END[0], minute=LUNCH_END[1], second=0, microsecond=0)

    cur = day_start
    while cur + timedelta(minutes=SLOT_MINUTES) <= day_end:
        # Slot fully overlaps lunch -> skip; jump to after lunch
        if cur < lunch_end and cur + timedelta(minutes=SLOT_MINUTES) > lunch_start:
            cur = lunch_end
            continue
        starts.append(cur)
        cur += timedelta(minutes=SLOT_MINUTES)
    return starts


def schedule_for_day(panel: models.Panel, day: int) -> list[tuple[models.Team, datetime, datetime]]:
    """Return [(team, start_dt, end_dt)] for the requested day. Times are naive
    local IST (no tzinfo) — the .ics layer attaches TZID:India Standard Time."""
    if day not in EVENT_DATES:
        raise ValueError(f"day must be 1 or 2, got {day}")
    year, month, dom = EVENT_DATES[day]
    date = datetime(year, month, dom)

    all_teams = [pt.team for pt in panel.teams if pt.team is not None]
    sorted_teams = _sort_teams(all_teams)
    day1_teams, day2_teams = _split_for_days(sorted_teams)
    teams_for_day = day1_teams if day == 1 else day2_teams

    if not teams_for_day:
        return []

    slot_starts = _generate_slot_starts(date)
    if len(teams_for_day) > len(slot_starts):
        raise ValueError(
            f"Panel has {len(teams_for_day)} teams for Day {day} but only "
            f"{len(slot_starts)} {SLOT_MINUTES}-min slots fit between "
            f"{WORK_START[0]:02d}:{WORK_START[1]:02d} and "
            f"{WORK_END[0]:02d}:{WORK_END[1]:02d} IST (lunch "
            f"{LUNCH_START[0]:02d}:{LUNCH_START[1]:02d}-{LUNCH_END[0]:02d}:{LUNCH_END[1]:02d} excluded). "
            f"Split the panel into smaller groups or shorten slots before generating the invite."
        )

    out: list[tuple[models.Team, datetime, datetime]] = []
    for team, start in zip(teams_for_day, slot_starts):
        out.append((team, start, start + timedelta(minutes=SLOT_MINUTES)))
    return out


# ---- iCalendar (.ics) builder ----

def _ics_escape(text: str) -> str:
    """Escape per RFC 5545 §3.3.11 for TEXT fields (SUMMARY, DESCRIPTION, LOCATION)."""
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _ics_dt_local(dt: datetime) -> str:
    """Local-time stamp with TZID; e.g. '20260618T090000'. The DTSTART line
    is emitted with `;TZID=India Standard Time` so Outlook anchors correctly."""
    return dt.strftime("%Y%m%dT%H%M%S")


def _ics_dt_utc(dt: datetime) -> str:
    """UTC stamp ending in 'Z' for DTSTAMP."""
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _format_schedule_block(schedule: list[tuple[models.Team, datetime, datetime]]) -> str:
    """Multi-line plain-text schedule grid for the meeting body."""
    if not schedule:
        return "(no teams scheduled for this day)"

    lines: list[str] = []
    lines.append("Schedule (IST):")
    lines.append("")
    last_was_morning = True
    for team, start, end in schedule:
        # Insert the Lunch marker once when we cross noon to 14:00
        if last_was_morning and start.hour >= LUNCH_END[0]:
            lines.append(
                f"  {LUNCH_START[0]:02d}:{LUNCH_START[1]:02d} - "
                f"{LUNCH_END[0]:02d}:{LUNCH_END[1]:02d}   -- Lunch --"
            )
            last_was_morning = False
        mentor = (team.mentor_name or "—").strip().title() or "—"
        # Team name padded for readability; mentor in parens.
        team_label = team.name.strip()
        lines.append(
            f"  {start.strftime('%H:%M')} - {end.strftime('%H:%M')}   "
            f"{team_label}   (Mentor: {mentor})"
        )
    return "\n".join(lines)


def _html_escape(text: str) -> str:
    """HTML-escape so team names with special chars render safely in the email body."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


_DATE_SUFFIX = {1: "st", 2: "nd", 3: "rd"}


def _ordinal_date(d: datetime) -> str:
    """Render a date as '18th June' / '19th June' style (matching the
    ShortHack 2025 schedule template the organizing team is reusing)."""
    n = d.day
    suffix = "th" if 11 <= n <= 13 else _DATE_SUFFIX.get(n % 10, "th")
    return f"{n}{suffix} {d.strftime('%B')}"


def _format_schedule_html(
    schedule: list[tuple[models.Team, datetime, datetime]],
    panel_name: str,
    day_date: datetime,
) -> str:
    """HTML schedule table — 4 columns matching the ShortHack 2025 template:
    Team Name | Panel | Slot (date) | Time.

    Inline styles only — Outlook desktop ignores <style> blocks. A BREAK
    row spans all 4 columns where lunch falls (13:00 – 14:00 IST).
    """
    if not schedule:
        return "<p><em>(no teams scheduled for this day)</em></p>"

    date_label = _ordinal_date(day_date)
    rows_html: list[str] = []
    last_was_morning = True
    for team, start, _end in schedule:
        if last_was_morning and start.hour >= LUNCH_END[0]:
            rows_html.append(
                "<tr style='background:#dbe9f7;'>"
                "<td colspan='4' style='padding:10px 12px;border:1px solid #c9d6e8;text-align:center;"
                "font-weight:700;color:#0a4f99;letter-spacing:.5px;'>BREAK</td>"
                "</tr>"
            )
            last_was_morning = False

        rows_html.append(
            "<tr>"
            "<td style='padding:8px 12px;border:1px solid #c9d6e8;background:#ffffff;'>"
            f"<strong style='color:#1a1f26;'>{_html_escape(team.name)}</strong></td>"
            "<td style='padding:8px 12px;border:1px solid #c9d6e8;background:#ffffff;color:#1a1f26;'>"
            f"{_html_escape(panel_name)}</td>"
            "<td style='padding:8px 12px;border:1px solid #c9d6e8;background:#ffffff;color:#1a1f26;'>"
            f"{date_label}</td>"
            "<td style='padding:8px 12px;border:1px solid #c9d6e8;background:#ffffff;color:#1a1f26;"
            "font-family:Consolas,monospace;text-align:right;'>"
            f"{start.strftime('%H:%M')}</td>"
            "</tr>"
        )

    return (
        "<table cellpadding='0' cellspacing='0' border='0' style='border-collapse:collapse;width:100%;"
        "max-width:680px;font-family:Segoe UI,-apple-system,BlinkMacSystemFont,Arial,sans-serif;"
        "font-size:14px;margin:14px 0;'>"
        "<thead>"
        "<tr style='background:#0a4f99;color:#ffffff;'>"
        "<th style='padding:10px 12px;text-align:left;border:1px solid #0a4f99;font-weight:700;'>Team Name</th>"
        "<th style='padding:10px 12px;text-align:left;border:1px solid #0a4f99;font-weight:700;'>Panel</th>"
        "<th style='padding:10px 12px;text-align:left;border:1px solid #0a4f99;font-weight:700;'>Slot</th>"
        "<th style='padding:10px 12px;text-align:right;border:1px solid #0a4f99;font-weight:700;'>Time</th>"
        "</tr>"
        "</thead>"
        f"<tbody>{''.join(rows_html)}</tbody>"
        "</table>"
    )


def _build_invite_body_html(
    panel: models.Panel,
    day: int,
    schedule: list[tuple[models.Team, datetime, datetime]],
    day_date: datetime,
) -> str:
    """Branded HTML body for the calendar invite — matches the ShortHack 2025
    schedule template: 'Hi All' greeting, 'Guidelines for the Demo' numbered
    list, then the schedule table.

    Inline styles only since this is pasted into Outlook compose; Outlook
    desktop ignores <style> blocks and class selectors.
    """
    return (
        "<div style='font-family:Segoe UI,-apple-system,BlinkMacSystemFont,Arial,sans-serif;"
        "color:#2a2f36;font-size:14.5px;line-height:1.6;max-width:720px;'>"

        # Greeting
        "<p style='margin:0 0 12px;'>Hi All,</p>"

        # Excitement line
        "<p style='margin:0 0 18px;'>"
        f"We are excited to invite you to <strong>RealHack 2026</strong> — "
        f"{_html_escape(panel.name)} — Day {day} demos!"
        "</p>"

        # Guidelines section
        "<h3 style='margin:18px 0 8px;font-size:15px;color:#0a4f99;"
        "text-decoration:underline;font-weight:700;'>"
        "Guidelines for the Demo"
        "</h3>"
        "<ol style='margin:0 0 18px;padding-left:22px;'>"
        "<li style='margin:6px 0;'>"
        "Time for Demo + Q&amp;A is <strong>15 minutes</strong> only."
        "</li>"
        "<li style='margin:6px 0;'>"
        "It is advised to share the screen from the same laptop for both "
        "Presentation and Demo, so that we can keep the time on tab."
        "</li>"
        "<li style='margin:6px 0;'>"
        "Teams should be available online <strong>30 minutes</strong> prior "
        "to the allocated time slot."
        "</li>"
        "</ol>"

        # Schedule table
        f"{_format_schedule_html(schedule, panel.name, day_date)}"

        # Sign-off
        "<p style='margin:22px 0 0;font-size:13px;'>"
        "Questions? Reply to this invite or write to "
        "<a href='mailto:RealHack@realpage.com' style='color:#0078d4;'>RealHack@realpage.com</a>."
        "</p>"
        "<p style='margin:14px 0 0;font-size:13px;'>"
        "— <strong style='color:#0a4f99;'>RealHack 2026 Organizing Team</strong>"
        "</p>"
        "</div>"
    )


def _collect_attendees(
    panel: models.Panel,
    schedule: list[tuple[models.Team, datetime, datetime]],
) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Return (required, optional) lists of (email, common_name).

    Required: scheduled teams' members + their mentors
    Optional: organizer CC list

    Panel judges are intentionally excluded — the organizing team
    notifies judges through a separate channel, so they should not
    receive a calendar invite alongside teams.

    De-duplicated by lowercased email.
    """
    required: dict[str, str] = {}  # email_lower -> display name

    # Scheduled teams' members + mentors. Panel judges are intentionally
    # NOT added here; see docstring.
    for team, _, _ in schedule:
        if team.mentor_email:
            required.setdefault(team.mentor_email.lower(), (team.mentor_name or team.mentor_email).strip().title())
        for m in team.members:
            if m.email:
                required.setdefault(m.email.lower(), (m.name or m.email).strip().title())

    optional: dict[str, str] = {}
    for org_email in ORGANIZER_CC_EMAILS:
        key = org_email.lower()
        if key in required:
            continue  # someone is both an organizer and a member; keep as required
        optional[key] = org_email  # CN = the literal as written

    return (
        [(email, name) for email, name in required.items()],
        [(email, name) for email, name in optional.items()],
    )


def build_panel_invite_meta(panel: models.Panel, day: int) -> dict:
    """Return JSON-ready meeting metadata for the Outlook-Web compose deeplink.

    Used by new Outlook (which doesn't reliably open downloaded .ics files):
    the frontend opens https://outlook.office.com/calendar/deeplink/compose
    with subject/start/end/body/location pre-filled, and pastes the attendees
    from the clipboard.

    Times are ISO 8601 with the +05:30 IST offset baked in so Outlook anchors
    the meeting to IST regardless of the viewer's local timezone.
    """
    if day not in EVENT_DATES:
        raise ValueError(f"day must be 1 or 2, got {day}")

    schedule = schedule_for_day(panel, day)
    year, month, dom = EVENT_DATES[day]
    ist_tz = timezone(IST_OFFSET)
    day_start = datetime(year, month, dom, WORK_START[0], WORK_START[1], tzinfo=ist_tz)
    day_end = datetime(year, month, dom, WORK_END[0], WORK_END[1], tzinfo=ist_tz)

    required, optional = _collect_attendees(panel, schedule)

    summary = f"RealHack 2026 Judging — {panel.name} — Day {day} ({day_start.strftime('%b %d')})"
    body = (
        f"{summary}\n\n"
        f"{_format_schedule_block(schedule)}\n\n"
        f"Total teams this day: {len(schedule)}\n"
        f"Slot length: {SLOT_MINUTES} minutes\n\n"
        f"— RealHack 2026 Organizing Team"
    )
    body_html = _build_invite_body_html(panel, day, schedule, day_start)

    # Flat schedule rows for the frontend modal's preview table — same 4 columns
    # as the email body (Team / Panel / Slot date / Time start).
    date_label = _ordinal_date(day_start)
    schedule_rows = [
        {
            "team": team.name,
            "panel": panel.name,
            "slot": date_label,
            "time": start.strftime("%H:%M"),
            "mentor": (team.mentor_name or "").strip().title(),
        }
        for team, start, _end in schedule
    ]

    return {
        "subject": summary,
        "body": body,
        "body_html": body_html,
        "start_iso": day_start.isoformat(),
        "end_iso": day_end.isoformat(),
        "location": "Microsoft Teams Meeting",
        "required_emails": [email for email, _ in required],
        "optional_emails": [email for email, _ in optional],
        "team_count": len(schedule),
        "schedule": schedule_rows,
        "day_label": day_start.strftime("%A, %B %d, %Y"),
    }


def _vtimezone_block() -> str:
    """VTIMEZONE for India Standard Time. IST has no DST, so one STANDARD entry."""
    return (
        "BEGIN:VTIMEZONE\r\n"
        f"TZID:{IST_TZID}\r\n"
        "BEGIN:STANDARD\r\n"
        "DTSTART:19700101T000000\r\n"
        "TZOFFSETFROM:+0530\r\n"
        "TZOFFSETTO:+0530\r\n"
        "TZNAME:IST\r\n"
        "END:STANDARD\r\n"
        "END:VTIMEZONE\r\n"
    )


def build_panel_invite_ics(
    panel: models.Panel,
    day: int,
    organizer_email: str,
    organizer_name: str,
    db: Session,
) -> str:
    """Build the .ics body for a panel's judging-day Outlook invite.

    The result uses METHOD:REQUEST so Outlook opens it as a meeting; setting
    ORGANIZER to the signed-in user means they see the Send button (not
    Accept/Decline).
    """
    if day not in EVENT_DATES:
        raise ValueError(f"day must be 1 or 2, got {day}")

    schedule = schedule_for_day(panel, day)

    year, month, dom = EVENT_DATES[day]
    day_start = datetime(year, month, dom, WORK_START[0], WORK_START[1])
    day_end = datetime(year, month, dom, WORK_END[0], WORK_END[1])

    required, optional = _collect_attendees(panel, schedule)

    summary = f"RealHack 2026 Judging — {panel.name} — Day {day} ({day_start.strftime('%b %d')})"
    description_plain = (
        f"{summary}\n\n"
        f"{_format_schedule_block(schedule)}\n\n"
        f"Total teams this day: {len(schedule)}\n"
        f"Slot length: {SLOT_MINUTES} minutes\n"
        f"Organizers CC'd as optional attendees.\n\n"
        f"— RealHack 2026 Organizing Team"
    )

    now_utc = datetime.utcnow()
    uid = f"realhack-2026-{panel.id}-day{day}-{uuid.uuid4().hex[:8]}@realpage.com"

    lines: list[str] = []
    lines.append("BEGIN:VCALENDAR")
    lines.append("VERSION:2.0")
    lines.append("PRODID:-//RealPage//RealHack Pilot//EN")
    lines.append("METHOD:REQUEST")
    lines.append("CALSCALE:GREGORIAN")
    # VTIMEZONE inline (no trailing CRLF since we'll add via "\r\n".join)
    lines.append("BEGIN:VTIMEZONE")
    lines.append(f"TZID:{IST_TZID}")
    lines.append("BEGIN:STANDARD")
    lines.append("DTSTART:19700101T000000")
    lines.append("TZOFFSETFROM:+0530")
    lines.append("TZOFFSETTO:+0530")
    lines.append("TZNAME:IST")
    lines.append("END:STANDARD")
    lines.append("END:VTIMEZONE")

    lines.append("BEGIN:VEVENT")
    lines.append(f"UID:{uid}")
    lines.append(f"DTSTAMP:{_ics_dt_utc(now_utc)}")
    lines.append(f"DTSTART;TZID={IST_TZID}:{_ics_dt_local(day_start)}")
    lines.append(f"DTEND;TZID={IST_TZID}:{_ics_dt_local(day_end)}")
    lines.append(f"SUMMARY:{_ics_escape(summary)}")
    lines.append(f"DESCRIPTION:{_ics_escape(description_plain)}")
    lines.append("LOCATION:Microsoft Teams Meeting")
    lines.append("SEQUENCE:0")
    lines.append("STATUS:TENTATIVE")
    lines.append("TRANSP:OPAQUE")

    # We intentionally omit the ORGANIZER property. When ORGANIZER is set
    # (even to the signed-in user), Outlook 365 treats the .ics as a record
    # of an already-sent meeting and shows only Accept/Decline (greyed out
    # for the organizer) — no Send button. Without ORGANIZER, Outlook opens
    # the meeting in compose mode with Send available, which is what the
    # organizer needs in order to review and actually send invites.
    # organizer_email/organizer_name are still passed in for future use
    # (e.g. logging or a Graph-based send path).
    _ = organizer_email, organizer_name

    for email, name in required:
        lines.append(
            f"ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;"
            f"CN={_ics_escape(name)}:mailto:{email}"
        )
    for email, name in optional:
        lines.append(
            f"ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;"
            f"CN={_ics_escape(name)}:mailto:{email}"
        )

    lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")

    # RFC 5545: lines terminated by CRLF
    return "\r\n".join(lines) + "\r\n"
