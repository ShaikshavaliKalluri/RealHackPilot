"""One-shot verification of the Entra ID app registration.

Runs the OAuth authorization-code flow with a localhost loopback against
our app, then decodes the resulting delegated token and probes Microsoft
Graph with calls our real app will make.

Run from backend/ with the venv active:

    .\.venv\Scripts\python.exe verify_graph_auth.py

The script will open your default browser to sign in with your work account
(corporate SSO will likely sign you in silently). Once you complete sign-in,
the browser is redirected back to a temporary local server, the script picks
up the auth code, exchanges it for a token, and runs Graph probes.

Auth: see _device_code_auth.py for why we use auth-code-loopback instead of
device-code (Entra rejects device-code against confidential clients with
AADSTS7000218 unless the public-client-flows toggle is enabled, which our
security team won't approve).
"""
from __future__ import annotations

import json
import os
import sys

# Force line-buffered stdout so output streams to background-job logs in real time
sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]

import httpx
from dotenv import load_dotenv

from _device_code_auth import acquire_token, decode_jwt_payload

load_dotenv(".env")

TENANT = os.environ.get("AZURE_TENANT_ID", "")
CLIENT = os.environ.get("AZURE_CLIENT_ID", "")
SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")

# Scopes we ASKED for in the SR (delegated permissions). offline_access gives
# us a refresh token (useful for long-running provisioning).
REQUESTED_SCOPES = [
    "Mail.Send",
    "User.Read",
    "User.ReadBasic.All",
    "Team.ReadBasic.All",
    "Channel.Create",
    "ChannelMember.ReadWrite.All",
    "ChannelMessage.Send",
    "offline_access",
]


def main() -> int:
    if not (TENANT and CLIENT and SECRET):
        print("ERROR: AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET not all set in .env")
        return 1

    print(f"Tenant:    {TENANT}")
    print(f"Client ID: {CLIENT}")
    print(f"Secret:    {SECRET[:4]}...{SECRET[-4:]}  (len={len(SECRET)})")
    print()
    print("Initiating OAuth authorization-code flow (localhost loopback)...")

    result = acquire_token(TENANT, CLIENT, SECRET, REQUESTED_SCOPES)

    if "access_token" not in result:
        print()
        print("ERROR: did not receive an access token.")
        print(json.dumps(result, indent=2))
        return 3

    token = result["access_token"]
    claims = decode_jwt_payload(token)

    print()
    print("=== Signed in ===")
    print(f"  Name:    {claims.get('name', '(no name claim)')}")
    print(f"  UPN:     {claims.get('preferred_username') or claims.get('upn')}")
    print(f"  Object:  {claims.get('oid')}")
    print(f"  App:     {claims.get('app_displayname') or claims.get('appid')}")
    print(f"  Tenant:  {claims.get('tid')}")
    print(f"  Expires: in {result.get('expires_in')}s")
    print(f"  Refresh: {'yes' if result.get('refresh_token') else 'no'}")
    print()

    scp = claims.get("scp", "")
    granted = scp.split() if scp else []
    print(f"=== Delegated scopes granted [{len(granted)}] ===")
    requested_set = {s for s in REQUESTED_SCOPES if s != "offline_access"}
    granted_set = set(granted)
    for s in REQUESTED_SCOPES:
        if s == "offline_access":
            continue  # not visible in scp claim; signaled by presence of refresh_token
        mark = "[OK]" if s in granted_set else "[MISSING]"
        print(f"  {mark}  {s}")
    extras = granted_set - requested_set
    for s in sorted(extras):
        print(f"  [extra]  {s}")
    print()

    # ===== Real Graph probes using this user's token =====
    print("=== Live Graph API probes (as signed-in user) ===")
    headers = {"Authorization": f"Bearer {token}"}
    probes = [
        ("GET /me (no scope required)",
         "https://graph.microsoft.com/v1.0/me"),
        ("GET /me/joinedTeams (needs Team.ReadBasic.All delegated)",
         "https://graph.microsoft.com/v1.0/me/joinedTeams?$top=3"),
        ("GET /users?$top=1 (needs User.ReadBasic.All delegated)",
         "https://graph.microsoft.com/v1.0/users?$top=1"),
    ]
    for label, url in probes:
        try:
            r = httpx.get(url, headers=headers, timeout=15)
        except Exception as e:
            print(f"  [ERR]  {label} -> {e}")
            continue
        if r.status_code == 200:
            data = r.json()
            if "joinedTeams" in url or "/users" in url:
                items = data.get("value", [])
                print(f"  [200]  {label} -> {len(items)} item(s)")
                for it in items[:2]:
                    name = it.get("displayName") or it.get("userPrincipalName") or "(?)"
                    print(f"           - {name}")
            else:
                print(f"  [200]  {label} -> {data.get('displayName')} <{data.get('mail') or data.get('userPrincipalName')}>")
        elif r.status_code in (401, 403):
            err = ""
            try:
                err = r.json().get("error", {}).get("message", "")[:140]
            except Exception:
                err = r.text[:140]
            print(f"  [{r.status_code}] {label} -> {err}")
        else:
            print(f"  [{r.status_code}] {label}")

    print()
    print("Verification complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
