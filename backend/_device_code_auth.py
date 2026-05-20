"""Shared helpers for device-code OAuth against a CONFIDENTIAL-client Entra app.

Why this exists: MSAL's PublicClientApplication does the device-code flow but
does not pass `client_secret` in the token-exchange POST. Our app reg is a
confidential client (has a secret), so Entra rejects that exchange with
AADSTS7000218. The fix is to do the flow by hand and include credentials.

Notes from the trenches:
- We send `client_secret` to BOTH the /devicecode and /token endpoints. The
  first call establishes the flow as a confidential-client exchange; sending
  the secret only on /token leaves Entra in a state where it thinks the flow
  was public-initiated and rejects the secret at exchange time.
- We also send HTTP Basic auth on /token (RFC 6749 §2.3.1 — credentials in
  the Authorization header are the standard transmission), in addition to the
  body params. Belt-and-suspenders.
- Request body is explicitly URL-encoded with urllib so we don't rely on any
  HTTP-library form-encoding quirks.

The two CLIs that need delegated tokens (verify_graph_auth.py and
provision_team_channels.py) both import from here.

Set the env var REALHACK_DEVICE_CODE_DEBUG=1 to print the raw request bodies
(with secret redacted) before each POST. Useful when iterating on auth bugs.
"""
from __future__ import annotations

import base64
import json
import os
import time
from urllib.parse import urlencode

import httpx

_DEVICECODE_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode"
_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

_DEBUG = bool(os.environ.get("REALHACK_DEVICE_CODE_DEBUG"))


def _redact(body: str, client_secret: str) -> str:
    """Hide the secret in debug output so transcripts/logs don't leak it."""
    if not client_secret:
        return body
    return body.replace(client_secret, f"{client_secret[:4]}...REDACTED...{client_secret[-4:]}")


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    raw = f"{client_id}:{client_secret}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def initiate_device_flow(tenant: str, client_id: str, client_secret: str, scopes: list[str]) -> dict:
    """POST /devicecode and return user_code, device_code, verification_uri, etc.

    Sends client_secret too so Entra registers the flow as confidential — so
    the matching /token call later is accepted.
    """
    body = urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": " ".join(scopes),
    })
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": _basic_auth_header(client_id, client_secret),
    }
    if _DEBUG:
        print(f"[debug] POST /devicecode body: {_redact(body, client_secret)}")

    r = httpx.post(
        _DEVICECODE_URL.format(tenant=tenant),
        content=body,
        headers=headers,
        timeout=30,
    )
    if _DEBUG:
        print(f"[debug] /devicecode -> {r.status_code} {r.text[:300]}")
    try:
        return r.json()
    except json.JSONDecodeError:
        return {"error": "non_json_response", "status_code": r.status_code, "body": r.text}


def poll_for_token(
    tenant: str,
    client_id: str,
    client_secret: str,
    device_code: str,
    interval: int,
    expires_in: int,
) -> dict:
    """Poll the token endpoint until sign-in completes (or times out).

    Includes credentials in BOTH the body (client_id + client_secret) and the
    Authorization: Basic header — RFC 6749 allows either, Entra accepts both,
    and sending them on both channels guarantees we're not tripped up by any
    parser quirk on either side.
    """
    deadline = time.monotonic() + expires_in
    poll_interval = max(interval, 1)

    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": _basic_auth_header(client_id, client_secret),
    }

    while time.monotonic() < deadline:
        time.sleep(poll_interval)
        body = urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "device_code": device_code,
        })
        if _DEBUG:
            print(f"[debug] POST /token body: {_redact(body, client_secret)}")

        r = httpx.post(
            _TOKEN_URL.format(tenant=tenant),
            content=body,
            headers=headers,
            timeout=30,
        )
        try:
            response = r.json()
        except json.JSONDecodeError:
            response = {"error": "non_json_response", "status_code": r.status_code, "body": r.text}

        if _DEBUG:
            preview = {k: v for k, v in response.items() if k != "access_token"}
            print(f"[debug] /token -> {r.status_code} {preview}")

        if r.status_code == 200 and "access_token" in response:
            return response

        err = response.get("error")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            poll_interval += 5
            continue
        if err in ("expired_token", "code_expired"):
            return {"error": err, "error_description": "Device code expired before sign-in completed."}
        if err == "authorization_declined":
            return {"error": err, "error_description": "User declined sign-in in the browser."}
        return response

    return {"error": "timeout", "error_description": "Polling timed out."}


def decode_jwt_payload(token: str) -> dict:
    """Decode the (unverified) JWT payload to read claims like scp/upn/oid."""
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    return json.loads(base64.urlsafe_b64decode(payload_b64))


def acquire_token(
    tenant: str,
    client_id: str,
    client_secret: str,
    scopes: list[str],
) -> dict:
    """High-level: run the whole device-code flow and return the token response.

    Returns the full Entra token response on success (access_token, expires_in,
    refresh_token if offline_access was requested, etc.), or `{"error": ..., "error_description": ...}`
    on failure.
    """
    flow = initiate_device_flow(tenant, client_id, client_secret, scopes)
    if "user_code" not in flow:
        return flow

    print()
    print("=" * 72)
    print(flow["message"])
    print("=" * 72)
    print()
    print(f"Polling Microsoft every ~{flow.get('interval', 5)}s. "
          f"Expires in {flow.get('expires_in', 900)}s if you don't sign in.")
    print()

    return poll_for_token(
        tenant,
        client_id,
        client_secret,
        device_code=flow["device_code"],
        interval=int(flow.get("interval", 5)),
        expires_in=int(flow.get("expires_in", 900)),
    )
