"""One-shot CLI: create a private Microsoft Teams channel for every registered team.

For each Team row in the DB that doesn't have a Teams channel yet:
  1. Resolve member emails + mentor email to Azure AD user IDs (via Graph /users/{email})
  2. POST a new private channel into the parent Team (GRAPH_PARENT_TEAM_ID in .env)
  3. Add all resolved members as channel members (mentor as Owner, members as regular)
  4. Update the Team row: has_teams_channel=True, teams_channel_id=<new id>
  5. Append a CommLog audit entry (status='sent', not 'mocked')

Auth: device-code flow. You'll be shown a verification URL + short code; sign in once
on any browser. The token (delegated, ~1 hour) is then used for all the Graph calls.

Idempotent: teams that already have a channel are skipped.

Usage:
    .\.venv\Scripts\python.exe provision_team_channels.py
    .\.venv\Scripts\python.exe provision_team_channels.py --dry-run   # show what would happen, no real calls
    .\.venv\Scripts\python.exe provision_team_channels.py --only "Team A,Team B"  # subset by name
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from datetime import datetime
from typing import Iterable

# Line-buffered stdout for friendly streaming output
sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]

import httpx
from dotenv import load_dotenv
from msal import PublicClientApplication

# Make sure the app package is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db import SessionLocal  # noqa: E402
from app.models import Team, CommLog  # noqa: E402


load_dotenv(".env")

TENANT = os.environ.get("AZURE_TENANT_ID", "")
CLIENT = os.environ.get("AZURE_CLIENT_ID", "")
PARENT_TEAM = os.environ.get("GRAPH_PARENT_TEAM_ID", "")

# Scopes we need for: create channels, add members, post messages (later)
SCOPES = [
    "Channel.Create",
    "ChannelMember.ReadWrite.All",
    "ChannelMessage.Send",
    "User.ReadBasic.All",
    "Team.ReadBasic.All",
]

GRAPH = "https://graph.microsoft.com/v1.0"

# Naming convention agreed with organizing team:
#   "2026 Team - <Team name>"
# Max channel-display-name is 50 chars in Graph — long team names will be truncated.
CHANNEL_NAME_PREFIX = "2026 Team - "


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

def acquire_token() -> str:
    if not TENANT or not CLIENT:
        err("AZURE_TENANT_ID or AZURE_CLIENT_ID missing from .env")
        sys.exit(2)

    app = PublicClientApplication(
        CLIENT,
        authority=f"https://login.microsoftonline.com/{TENANT}",
    )

    print("Starting device-code sign-in...")
    flow = app.initiate_device_flow(scopes=SCOPES)
    if "user_code" not in flow:
        err("Could not start device flow.")
        print(json.dumps(flow, indent=2))
        sys.exit(3)

    print()
    hr()
    print(flow["message"])
    hr()
    print()
    print("Polling Microsoft for sign-in completion...")

    result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        err("Sign-in failed.")
        print(json.dumps(result, indent=2))
        sys.exit(4)

    token = result["access_token"]
    claims = decode_jwt_payload(token)
    print()
    ok(f"Signed in as: {claims.get('name')} ({claims.get('preferred_username') or claims.get('upn')})")
    ok(f"Granted scopes: {claims.get('scp', '(none)')}")
    print()
    return token


def decode_jwt_payload(token: str) -> dict:
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    return json.loads(base64.urlsafe_b64decode(payload_b64))


# ===== Graph calls =====

class GraphClient:
    def __init__(self, token: str, dry_run: bool = False) -> None:
        self.token = token
        self.dry_run = dry_run
        self.session = httpx.Client(
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=30,
        )

    def get_user_id_by_email(self, email: str) -> str | None:
        """Resolve a RealPage email to an Azure AD user objectId."""
        # Graph treats UPN, email, and id all as valid keys here
        r = self.session.get(f"{GRAPH}/users/{email}")
        if r.status_code == 200:
            return r.json().get("id")
        if r.status_code == 404:
            return None
        warn(f"  unexpected {r.status_code} resolving {email}: {r.text[:120]}")
        return None

    def create_private_channel(
        self,
        parent_team_id: str,
        display_name: str,
        description: str,
        member_ids: list[str],
        owner_ids: list[str],
    ) -> dict:
        """Create a private channel with members pre-attached."""
        if self.dry_run:
            return {"id": f"dryrun-{display_name[:12]}", "displayName": display_name, "_dry_run": True}

        members_payload: list[dict] = []
        owners_set = set(owner_ids)
        for uid in dict.fromkeys(member_ids):  # de-dup, preserve order
            entry = {
                "@odata.type": "#microsoft.graph.aadUserConversationMember",
                "user@odata.bind": f"{GRAPH}/users('{uid}')",
                "roles": ["owner"] if uid in owners_set else [],
            }
            members_payload.append(entry)

        body = {
            "@odata.type": "#Microsoft.Graph.channel",
            "membershipType": "private",
            "displayName": display_name[:50],  # Graph rejects > 50 chars
            "description": description[:1024],
            "members": members_payload,
        }
        r = self.session.post(f"{GRAPH}/teams/{parent_team_id}/channels", json=body)
        if r.status_code in (200, 201, 202):
            return r.json() if r.text else {"status": r.status_code}
        raise RuntimeError(f"channel create failed ({r.status_code}): {r.text[:300]}")

    def close(self) -> None:
        self.session.close()


# ===== DB helpers =====

def teams_to_process(only: list[str] | None) -> list[Team]:
    """Pick teams that don't have channels yet, optionally filtered by name."""
    with SessionLocal() as s:
        q = s.query(Team).filter((Team.has_teams_channel == False) | (Team.has_teams_channel.is_(None)))  # noqa: E712
        if only:
            q = q.filter(Team.name.in_(only))
        return q.order_by(Team.name.asc()).all()


def update_team_after_create(team_id: int, channel_id: str, sent_by_email: str, dry_run: bool) -> None:
    with SessionLocal() as s:
        team = s.query(Team).get(team_id)
        if not team:
            return
        team.has_teams_channel = True
        team.teams_channel_id = channel_id
        team.teams_channel_created_at = datetime.utcnow()
        s.add(CommLog(
            team_id=team_id,
            kind="teams_channel_create",
            subject=f"Channel created: {team.name}",
            body=f"Channel ID: {channel_id}",
            status=("dry_run" if dry_run else "sent"),
            sent_by_email=sent_by_email,
        ))
        s.commit()


# ===== Main =====

def main() -> int:
    parser = argparse.ArgumentParser(description="Provision Microsoft Teams channels for RealHack teams")
    parser.add_argument("--dry-run", action="store_true", help="resolve users and print plan, but do not call Graph or update DB")
    parser.add_argument("--only", default="", help="comma-separated team names to provision (default: all without a channel)")
    args = parser.parse_args()

    if not PARENT_TEAM:
        err("GRAPH_PARENT_TEAM_ID is not set in .env.")
        err("Open the parent Team in Microsoft Teams → ... → 'Get link to team' → copy the value after 'groupId='.")
        return 2

    only_names = [s.strip() for s in args.only.split(",") if s.strip()] if args.only else None

    print()
    hr("#")
    print("# RealHack Pilot — Teams channel provisioning")
    if args.dry_run:
        print("# DRY RUN mode — no Graph calls will be made, no DB updates")
    hr("#")
    print()
    info(f"Parent Team ID: {PARENT_TEAM}")
    if only_names:
        info(f"Filtering to: {only_names}")

    token = acquire_token()
    graph = GraphClient(token, dry_run=args.dry_run)
    signed_in_email = decode_jwt_payload(token).get("preferred_username") or "organizer@realpage.com"

    teams = teams_to_process(only_names)
    if not teams:
        info("No teams pending channel creation. (Use --only or check has_teams_channel flag.)")
        graph.close()
        return 0
    info(f"{len(teams)} team(s) pending channel creation.")
    print()

    created = 0
    skipped: list[tuple[str, str]] = []
    for t in teams:
        hr("-")
        print(f"Team: {t.name}  (id={t.id})")

        # Build candidate email list (mentor first → becomes owner, then members)
        candidate_emails: list[tuple[str, bool]] = []  # (email, is_owner)
        if t.mentor_email:
            candidate_emails.append((t.mentor_email.strip(), True))
        for m in t.members:
            if m.email:
                candidate_emails.append((m.email.strip(), False))

        if not candidate_emails:
            warn("no member emails on file — skipping (2024 data export didn't capture member emails; 2026 export does)")
            skipped.append((t.name, "no emails"))
            continue

        # Resolve to AD IDs
        member_ids: list[str] = []
        owner_ids: list[str] = []
        unresolved: list[str] = []
        for email, is_owner in candidate_emails:
            uid = graph.get_user_id_by_email(email)
            if uid:
                member_ids.append(uid)
                if is_owner:
                    owner_ids.append(uid)
                info(f"resolved {email} -> {uid}")
            else:
                unresolved.append(email)
                warn(f"could not resolve {email} in Azure AD (guest? wrong domain? typo?)")

        if not member_ids:
            warn("no resolvable members — skipping")
            skipped.append((t.name, "all emails unresolvable"))
            continue
        if not owner_ids:
            # Private channels must have at least one owner — promote first member
            owner_ids = [member_ids[0]]
            warn(f"no mentor on file — promoting first member to channel owner")

        # Create the channel
        channel_display_name = f"{CHANNEL_NAME_PREFIX}{t.name}"
        if len(channel_display_name) > 50:
            warn(f"channel name '{channel_display_name}' exceeds 50 chars; will be truncated by Graph")
        info(f"will create channel: \"{channel_display_name[:50]}\"")

        try:
            ch = graph.create_private_channel(
                parent_team_id=PARENT_TEAM,
                display_name=channel_display_name,
                description=f"RealHack 2026 — private channel for team {t.name}.",
                member_ids=member_ids,
                owner_ids=owner_ids,
            )
        except Exception as e:
            err(f"channel creation failed for '{t.name}': {e}")
            skipped.append((t.name, str(e)[:120]))
            continue

        channel_id = ch.get("id", "")
        ok(f"channel created -> id={channel_id}")
        update_team_after_create(t.id, channel_id, sent_by_email=signed_in_email, dry_run=args.dry_run)
        created += 1

    graph.close()

    print()
    hr("#")
    print(f"# Done. Created: {created}, Skipped: {len(skipped)}")
    for name, reason in skipped:
        print(f"#   skipped {name}: {reason}")
    hr("#")
    return 0 if created else (1 if skipped else 0)


if __name__ == "__main__":
    sys.exit(main())
