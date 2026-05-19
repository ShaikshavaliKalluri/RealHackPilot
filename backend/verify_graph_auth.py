"""One-shot verification of the Entra ID app registration.

Runs the OAuth device-code flow against our app, then decodes the resulting
delegated token and probes Microsoft Graph with calls our real app will make.

Run from backend/ with the venv active:

    .\.venv\Scripts\python.exe verify_graph_auth.py

You'll be shown a verification URL and a short code. Open the URL on any
browser (your work laptop is fine — corporate SSO will likely sign you in
silently), enter the code, confirm. Token comes back. Script prints
everything it can verify.
"""
from __future__ import annotations

import base64
import json
import os
import sys

# Force line-buffered stdout so output streams to background-job logs in real time
sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]

import httpx
from dotenv import load_dotenv
from msal import PublicClientApplication

load_dotenv(".env")

TENANT = os.environ.get("AZURE_TENANT_ID", "")
CLIENT = os.environ.get("AZURE_CLIENT_ID", "")
SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")

# Scopes we ASKED for in the SR (delegated permissions).
# We use individual scope strings (not /.default) so we can see exactly which
# ones come back as granted versus which ones get filtered out.
REQUESTED_SCOPES = [
    "Mail.Send",
    "User.Read",
    "User.ReadBasic.All",
    "Team.ReadBasic.All",
    "Channel.Create",
    "ChannelMember.ReadWrite.All",
    "ChannelMessage.Send",
]


def decode_jwt_payload(token: str) -> dict:
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    return json.loads(base64.urlsafe_b64decode(payload_b64))


def main() -> int:
    if not (TENANT and CLIENT and SECRET):
        print("ERROR: AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET not all set in .env")
        return 1

    print(f"Tenant:    {TENANT}")
    print(f"Client ID: {CLIENT}")
    print(f"Secret:    {SECRET[:4]}...{SECRET[-4:]}  (len={len(SECRET)})")
    print()

    # Device-code is a PUBLIC client flow (the user is the credential, not the app secret).
    # The real backend in production will still use a confidential client + the secret.
    app = PublicClientApplication(
        CLIENT,
        authority=f"https://login.microsoftonline.com/{TENANT}",
    )

    print("Initiating device-code flow...")
    flow = app.initiate_device_flow(scopes=REQUESTED_SCOPES)
    if "user_code" not in flow:
        print()
        print("ERROR: device-code flow could not start.")
        print(json.dumps(flow, indent=2))
        if flow.get("error") in ("invalid_client", "unauthorized_client"):
            print()
            print("This usually means: 'Allow public client flows' is set to NO on the app.")
            print("Fix in Entra Admin Center > App registrations > RealHack Pilot > Authentication >")
            print("  Advanced settings > Allow public client flows -> Yes -> Save.")
            print("(This setting is required for device-code; production MSAL.js does NOT need it.)")
        return 2

    print()
    print("=" * 72)
    print(flow["message"])  # human-readable: "go to https://microsoft.com/devicelogin and enter code XXXX"
    print("=" * 72)
    print()
    print("Waiting for sign-in (this script will poll Microsoft every ~5s)...")

    # acquire_token_by_device_flow blocks until success or timeout
    result = app.acquire_token_by_device_flow(flow)

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
    print()

    scp = claims.get("scp", "")
    granted = scp.split() if scp else []
    print(f"=== Delegated scopes granted [{len(granted)}] ===")
    requested_set = set(REQUESTED_SCOPES)
    granted_set = set(granted)
    for s in REQUESTED_SCOPES:
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
