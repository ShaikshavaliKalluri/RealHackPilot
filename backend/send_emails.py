"""One-shot CLI: render a template and email it to selected teams via Graph.

Usage:
    .\.venv\Scripts\python.exe send_emails.py --template welcome --dry-run
    .\.venv\Scripts\python.exe send_emails.py --template welcome
    .\.venv\Scripts\python.exe send_emails.py --template welcome --only "Team A,Team B"
    .\.venv\Scripts\python.exe send_emails.py --template welcome --cc-organizer

Auth: same OAuth authorization-code + localhost loopback flow as
provision_team_channels.py (see _device_code_auth.py). Sign in once per
script run; the resulting delegated token is good for ~1 hour.

Send mechanics:
- If GRAPH_MAIL_FROM is set in .env (e.g. RealHack@realpage.com), every
  message is sent via /users/<GRAPH_MAIL_FROM>/sendMail so it shows the
  shared mailbox as the From address. This requires Send-As permission
  on that mailbox in Exchange for the signed-in user.
- If GRAPH_MAIL_FROM is empty, falls back to /me/sendMail (sends as the
  signed-in user themselves).

CommLog: every successful send writes a status="sent" row. Dry-run writes
nothing — matches provision_team_channels.py behavior.

Rate limiting: Graph allows roughly 30 sendMail calls per minute per
mailbox. We pace at ~1.5s between calls so 48 teams takes ~75s and stays
comfortably under any per-minute cap.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

# Line-buffered stdout for friendly streaming output
sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]

import httpx
from dotenv import load_dotenv

# Make sure the app package is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _device_code_auth import acquire_token, decode_jwt_payload  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.emails import TEMPLATES, render_many  # noqa: E402
from app.models import CommLog, Team  # noqa: E402

load_dotenv(".env")

TENANT = os.environ.get("AZURE_TENANT_ID", "")
CLIENT = os.environ.get("AZURE_CLIENT_ID", "")
SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")
MAIL_FROM = (os.environ.get("GRAPH_MAIL_FROM", "") or "").strip()

# Mail.Send is the only scope we strictly need for sending. We include
# offline_access to get a refresh token (script doesn't use it today, but
# saves a sign-in on the next run if we add caching).
SCOPES = [
    "Mail.Send",
    "User.Read",
    "offline_access",
]

GRAPH = "https://graph.microsoft.com/v1.0"

# Pace between sends — see module docstring.
INTER_SEND_DELAY_SEC = 1.5


# ===== Output helpers =====

def hr(char: str = "=", width: int = 72) -> None:
    print(char * width)


def info(msg: str) -> None:
    print(f"  {msg}")


def ok(msg: str) -> None:
    print(f"  [OK] {msg}")


def warn(msg: str) -> None:
    print(f"  [WARN] {msg}")


def err(msg: str) -> None:
    print(f"  [ERROR] {msg}")


# ===== Auth =====

def get_access_token() -> tuple[str, str]:
    """Run sign-in and return (access_token, signed_in_email)."""
    if not TENANT or not CLIENT or not SECRET:
        err("AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET must all be set in .env")
        sys.exit(2)

    print("Starting browser sign-in...")
    result = acquire_token(TENANT, CLIENT, SECRET, SCOPES)
    if "access_token" not in result:
        err("Sign-in failed.")
        print(json.dumps(result, indent=2))
        sys.exit(4)

    token = result["access_token"]
    claims = decode_jwt_payload(token)
    signed_in_email = claims.get("preferred_username") or claims.get("upn") or "unknown@realpage.com"
    ok(f"Signed in as: {claims.get('name')} ({signed_in_email})")
    print()
    return token, signed_in_email


# ===== Graph send =====

def send_one(
    session: httpx.Client,
    *,
    subject: str,
    body_text: str,
    body_html: str | None,
    to_emails: list[str],
    cc_emails: list[str] | None,
    send_as: str | None,
) -> tuple[int, str]:
    """POST /sendMail. Returns (status_code, response_text_or_empty).

    Uses HTML body when provided (richer formatting); falls back to plain text.
    """
    content_type = "HTML" if body_html else "text"
    content = body_html if body_html else body_text
    message: dict[str, Any] = {
        "subject": subject,
        "body": {"contentType": content_type, "content": content},
        "toRecipients": [{"emailAddress": {"address": e}} for e in to_emails if e],
    }
    if cc_emails:
        message["ccRecipients"] = [{"emailAddress": {"address": e}} for e in cc_emails if e]

    payload = {"message": message, "saveToSentItems": True}

    if send_as:
        url = f"{GRAPH}/users/{send_as}/sendMail"
    else:
        url = f"{GRAPH}/me/sendMail"

    r = session.post(url, json=payload)
    # Graph returns 202 Accepted on a successful queue, sometimes 200/204
    return r.status_code, r.text[:300]


# ===== DB =====

def write_log(
    *,
    team_id: int,
    template_id: str,
    subject: str,
    body: str,
    recipients: list[str],
    status: str,
    sent_by_email: str,
) -> None:
    with SessionLocal() as s:
        s.add(CommLog(
            team_id=team_id,
            kind="email",
            template_id=template_id,
            subject=subject,
            body=body,
            recipients=recipients,
            status=status,
            sent_by_email=sent_by_email,
        ))
        s.commit()


# ===== Main =====

def main() -> int:
    parser = argparse.ArgumentParser(description="Send a template email to teams")
    parser.add_argument(
        "--template",
        required=True,
        help=f"Template id. One of: {', '.join(t.id for t in TEMPLATES)}",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Render and print the plan + bodies; do not send and do not write CommLog.",
    )
    parser.add_argument(
        "--only",
        default="",
        help="Comma-separated team names to send to (default: every team).",
    )
    parser.add_argument(
        "--cc-organizer",
        action="store_true",
        help="CC the signed-in organizer on each send for audit trail.",
    )
    args = parser.parse_args()

    template = next((t for t in TEMPLATES if t.id == args.template), None)
    if not template:
        err(f"Unknown template: {args.template}")
        info(f"Available: {', '.join(t.id for t in TEMPLATES)}")
        return 1

    only_names = [s.strip() for s in args.only.split(",") if s.strip()] if args.only else None

    print()
    hr("#")
    print(f"# RealHack Pilot — email send: {template.label}")
    if args.dry_run:
        print("# DRY RUN — no Graph calls, no CommLog writes")
    hr("#")
    print()
    info(f"Template:  {template.id}")
    info(f"Audience:  {template.audience}")
    if MAIL_FROM:
        info(f"From:      {MAIL_FROM}   (Send-As; requires Exchange permission on this mailbox)")
    else:
        info("From:      signed-in user (GRAPH_MAIL_FROM is empty)")
    if args.cc_organizer:
        info("CC:        signed-in organizer on every message")
    if only_names:
        info(f"Filter:    {only_names}")

    # Render
    with SessionLocal() as s:
        team_ids_filter: list[int] | None = None
        if only_names:
            matched = s.query(Team).filter(Team.name.in_(only_names)).all()
            if not matched:
                err(f"No teams matched --only {only_names}")
                return 1
            team_ids_filter = [t.id for t in matched]
        rendered = render_many(s, template.id, team_ids_filter)

    rendered = [r for r in rendered if r["to"] or template.audience == "mentor"]

    if not rendered:
        info("Nothing to send (no teams matched, or all matched teams had no recipients).")
        return 0

    info(f"{len(rendered)} message(s) queued.")
    print()

    # Acquire token (skip for dry-run)
    token = ""
    signed_in_email = "dry-run@realpage.com"
    if not args.dry_run:
        token, signed_in_email = get_access_token()

    sent = 0
    skipped: list[tuple[str, str]] = []

    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with httpx.Client(headers=headers, timeout=30) as client:
        for r in rendered:
            hr("-")
            print(f"Team: {r['team_name']}  (audience: {r['audience']})")
            recipients = [e for e in r["to"] if e]
            info(f"To:       {', '.join(recipients) if recipients else '(none)'}")
            info(f"Subject:  {r['subject']}")

            if not recipients:
                warn("no recipients on file — skipping")
                skipped.append((r["team_name"], "no recipients"))
                continue

            if args.dry_run:
                print()
                print("    --- body ---")
                for line in r["body"].splitlines():
                    print(f"    {line}")
                print("    --- end body ---")
                ok(f"would send to {len(recipients)} recipient(s)")
                continue

            cc = [signed_in_email] if args.cc_organizer else None
            try:
                status, resp_text = send_one(
                    client,
                    subject=r["subject"],
                    body_text=r["body"],
                    body_html=r.get("body_html"),
                    to_emails=recipients,
                    cc_emails=cc,
                    send_as=MAIL_FROM or None,
                )
            except Exception as e:
                err(f"send failed for '{r['team_name']}': {e}")
                skipped.append((r["team_name"], str(e)[:120]))
                continue

            if status in (200, 202, 204):
                ok(f"sent ({status})")
                write_log(
                    team_id=r["team_id"],
                    template_id=template.id,
                    subject=r["subject"],
                    body=r["body"],
                    recipients=recipients,
                    status="sent",
                    sent_by_email=signed_in_email,
                )
                sent += 1
            else:
                err(f"send failed for '{r['team_name']}' ({status}): {resp_text}")
                skipped.append((r["team_name"], f"{status}: {resp_text[:80]}"))

            # Pace between sends so we stay under Graph's per-minute caps.
            time.sleep(INTER_SEND_DELAY_SEC)

    print()
    hr("#")
    print(f"# Done. Sent: {sent}, Skipped/failed: {len(skipped)}, Total: {len(rendered)}")
    for name, reason in skipped:
        print(f"#   skipped {name}: {reason}")
    hr("#")
    return 0 if not skipped else 1


if __name__ == "__main__":
    sys.exit(main())
