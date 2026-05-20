"""Quick one-off test of the email send pipeline.

Doesn't touch the DB — just signs in, sends one email to the address you
specify, exits. Useful for verifying that:
  - the OAuth code-loopback sign-in still works
  - Mail.Send is granted on the token
  - Send-As permission on GRAPH_MAIL_FROM (RealHack@realpage.com) is granted

Usage:
    .\.venv\Scripts\python.exe test_send_email.py shaikshavali.kalluri@realpage.com

If Send-As is not granted on the shared mailbox you'll get a 403 — temporarily
unset GRAPH_MAIL_FROM in backend/.env and re-run, and it'll send as you instead.
"""
from __future__ import annotations

import json
import os
import sys

sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]

import httpx
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _device_code_auth import acquire_token, decode_jwt_payload  # noqa: E402

load_dotenv(".env")

TENANT = os.environ.get("AZURE_TENANT_ID", "")
CLIENT = os.environ.get("AZURE_CLIENT_ID", "")
SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")
MAIL_FROM = (os.environ.get("GRAPH_MAIL_FROM", "") or "").strip()

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = ["Mail.Send", "User.Read", "offline_access"]


def main(to_email: str) -> int:
    if not (TENANT and CLIENT and SECRET):
        print("ERROR: AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET not all set in .env")
        return 1

    print("Signing in...")
    result = acquire_token(TENANT, CLIENT, SECRET, SCOPES)
    if "access_token" not in result:
        print("ERROR: sign-in failed")
        print(json.dumps(result, indent=2))
        return 2

    token = result["access_token"]
    claims = decode_jwt_payload(token)
    signed_in = claims.get("preferred_username") or claims.get("upn") or "?"
    print(f"Signed in as: {signed_in}")
    print()

    if MAIL_FROM:
        url = f"{GRAPH}/users/{MAIL_FROM}/sendMail"
        print(f"Sending via /users/{MAIL_FROM}/sendMail  (Send-As path)")
    else:
        url = f"{GRAPH}/me/sendMail"
        print(f"Sending via /me/sendMail  (will appear from your account)")

    body_text = (
        "Hi,\n\n"
        "This is a test of the RealHack Pilot email send pipeline.\n\n"
        f"From mailbox: {MAIL_FROM or signed_in}\n"
        f"Signed in as: {signed_in}\n\n"
        "If this arrived in your inbox, the send pipeline is working end-to-end.\n\n"
        "Next steps:\n"
        "  1. Run `python send_emails.py --template welcome --dry-run` to preview "
        "the per-team mail-merge.\n"
        "  2. Then drop the --dry-run flag to actually send.\n\n"
        "— RealHack Pilot test"
    )
    message = {
        "subject": "RealHack Pilot — email pipeline test",
        "body": {"contentType": "text", "content": body_text},
        "toRecipients": [{"emailAddress": {"address": to_email}}],
    }
    payload = {"message": message, "saveToSentItems": True}

    r = httpx.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )

    if r.status_code in (200, 202, 204):
        print(f"  [OK] sent ({r.status_code}). Check {to_email} — should arrive within ~30 seconds.")
        return 0

    print(f"  [ERROR] send failed ({r.status_code}):")
    print(r.text[:800])

    if MAIL_FROM and r.status_code in (401, 403, 404):
        print()
        print("Most likely cause: Send-As permission on the shared mailbox isn't granted yet.")
        print("Two options:")
        print(f"  1. Ask Exchange admin to grant {signed_in} 'Send As' on {MAIL_FROM}")
        print(f"  2. Quick workaround: blank GRAPH_MAIL_FROM in backend/.env and re-run —")
        print(f"     the email will go out from {signed_in} instead of the shared mailbox.")
    return 3


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_send_email.py <to-email>")
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
