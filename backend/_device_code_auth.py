"""Shared helpers for device-code OAuth against a CONFIDENTIAL-client Entra app.

Why this exists: MSAL's PublicClientApplication does the device-code flow but
does not pass `client_secret` in the token-exchange POST. Our app reg is a
confidential client (has a secret), so Entra rejects that exchange with
AADSTS7000218. The fix is to do the flow by hand and include the secret.

The two CLIs that need delegated tokens (verify_graph_auth.py and
provision_team_channels.py) both import from here.
"""
from __future__ import annotations

import base64
import json
import time

import httpx

_DEVICECODE_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode"
_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def initiate_device_flow(tenant: str, client_id: str, scopes: list[str]) -> dict:
    """POST /devicecode and return user_code, device_code, verification_uri, etc."""
    r = httpx.post(
        _DEVICECODE_URL.format(tenant=tenant),
        data={"client_id": client_id, "scope": " ".join(scopes)},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def poll_for_token(
    tenant: str,
    client_id: str,
    client_secret: str,
    device_code: str,
    interval: int,
    expires_in: int,
) -> dict:
    """Poll the token endpoint until sign-in completes (or times out).

    Includes client_secret in the POST so Entra accepts the device-code grant
    against a confidential-client app — sidesteps the "Allow public client
    flows" toggle requirement (AADSTS7000218).
    """
    deadline = time.monotonic() + expires_in
    poll_interval = max(interval, 1)

    while time.monotonic() < deadline:
        time.sleep(poll_interval)
        r = httpx.post(
            _TOKEN_URL.format(tenant=tenant),
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "device_code": device_code,
            },
            timeout=30,
        )
        body = r.json()

        if r.status_code == 200 and "access_token" in body:
            return body

        err = body.get("error")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            poll_interval += 5
            continue
        if err in ("expired_token", "code_expired"):
            return {"error": err, "error_description": "Device code expired before sign-in completed."}
        if err == "authorization_declined":
            return {"error": err, "error_description": "User declined sign-in in the browser."}
        return body

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
    flow = initiate_device_flow(tenant, client_id, scopes)
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
