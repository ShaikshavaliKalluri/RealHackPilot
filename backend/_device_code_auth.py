"""Shared helpers for OAuth against the RealHack Pilot Entra app.

Implements the OAuth 2.0 authorization-code flow with a localhost loopback
redirect (RFC 8252 §7.3 — the recommended pattern for native/CLI clients).

Why this flow vs device-code:
We tried device-code first, but Entra's strict token-issuance validator
rejects device-code requests against confidential-client apps with
AADSTS7000218, no matter how credentials are transmitted (body, Basic
auth header, or both). This is gated by the "Allow public client flows"
toggle, which the security team didn't want enabled.

The authorization-code flow is the standard alternative. It works with
confidential clients out of the box because the code → token exchange is
a normal authenticated POST. The "localhost" redirect URI is accepted by
Entra at any port at runtime (per Microsoft docs and RFC 8252).

End-user experience: identical to device-code from the user's perspective
— a browser opens, they sign in, control returns to the script.

Module-level API kept stable across implementations:
    acquire_token(tenant, client_id, client_secret, scopes) -> dict
    decode_jwt_payload(token) -> dict

Set REALHACK_DEVICE_CODE_DEBUG=1 to print the authorize URL and the
(secret-redacted) token POST body. Handy for diagnosing auth issues.
"""
from __future__ import annotations

import base64
import http.server
import json
import os
import secrets
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from typing import Optional

import httpx

_AUTHORIZE_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

_DEBUG = bool(os.environ.get("REALHACK_DEVICE_CODE_DEBUG"))

# How long we wait for the user to complete sign-in in the browser before
# giving up. 5 minutes is generous for SSO + MFA prompts.
_LOOPBACK_TIMEOUT_SEC = 300


def _redact(body: str, client_secret: str) -> str:
    if not client_secret:
        return body
    return body.replace(client_secret, f"{client_secret[:4]}...REDACTED...{client_secret[-4:]}")


class _LoopbackHandler(http.server.BaseHTTPRequestHandler):
    """Catches the single GET that Entra sends after the user signs in."""

    # Class attributes mutated by the run loop below.
    captured_query: Optional[dict] = None

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        # parse_qs returns lists; flatten to single values
        _LoopbackHandler.captured_query = {k: v[0] for k, v in query.items()}

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()

        if "code" in _LoopbackHandler.captured_query:
            page = _SUCCESS_PAGE
        else:
            err = _LoopbackHandler.captured_query.get("error", "(no error code)")
            desc = _LoopbackHandler.captured_query.get("error_description", "")
            page = _ERROR_PAGE_TEMPLATE.format(error=_html_escape(err), desc=_html_escape(desc))
        self.wfile.write(page.encode("utf-8"))

    def log_message(self, format, *args):  # noqa: A002
        # Quiet — we don't want every favicon.ico request spamming stderr.
        return


def _html_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;").replace("'", "&#39;"))


_SUCCESS_PAGE = """<!doctype html>
<html><head><title>Sign-in complete</title></head>
<body style="font-family: -apple-system, Segoe UI, sans-serif; padding: 40px;">
  <h2>Sign-in complete</h2>
  <p>You can close this window and return to the CLI.</p>
</body></html>
"""

_ERROR_PAGE_TEMPLATE = """<!doctype html>
<html><head><title>Sign-in error</title></head>
<body style="font-family: -apple-system, Segoe UI, sans-serif; padding: 40px;">
  <h2>Sign-in error</h2>
  <p><strong>{error}</strong></p>
  <p>{desc}</p>
  <p>Return to the CLI for next steps.</p>
</body></html>
"""


def _run_loopback_server() -> tuple[socketserver.TCPServer, int]:
    """Bind an ephemeral port on 127.0.0.1 and start serving in a background thread."""
    # port=0 lets the OS choose an unused port
    server = socketserver.TCPServer(("127.0.0.1", 0), _LoopbackHandler, bind_and_activate=False)
    server.allow_reuse_address = True
    server.server_bind()
    server.server_activate()
    port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def acquire_token(
    tenant: str,
    client_id: str,
    client_secret: str,
    scopes: list[str],
) -> dict:
    """Run the OAuth authorization-code flow with a localhost loopback redirect.

    Returns the full Entra token response on success (access_token, expires_in,
    refresh_token if offline_access was requested, etc.), or
    `{"error": ..., "error_description": ...}` on failure.
    """
    # 1. Stand up a one-shot HTTP server on 127.0.0.1:<random port>
    _LoopbackHandler.captured_query = None
    server, port = _run_loopback_server()
    redirect_uri = f"http://localhost:{port}"

    try:
        # 2. Build the authorize URL and open the user's browser
        state = secrets.token_urlsafe(16)
        scope_str = " ".join(scopes)
        params = {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "response_mode": "query",
            "scope": scope_str,
            "state": state,
            "prompt": "select_account",  # avoid silent re-use of the wrong tenant cache
        }
        authorize_url = _AUTHORIZE_URL.format(tenant=tenant) + "?" + urllib.parse.urlencode(params)
        if _DEBUG:
            print(f"[debug] authorize URL: {authorize_url}")

        print()
        print("=" * 72)
        print("Opening browser for sign-in...")
        print(f"  Redirect URI: {redirect_uri}  (one-shot, this run only)")
        print(f"If the browser doesn't open, paste this URL manually:")
        print(f"  {authorize_url}")
        print("=" * 72)
        print()

        webbrowser.open(authorize_url)

        # 3. Wait up to _LOOPBACK_TIMEOUT_SEC for the redirect to land
        deadline = threading.Event()
        timer = threading.Timer(_LOOPBACK_TIMEOUT_SEC, deadline.set)
        timer.start()
        try:
            while _LoopbackHandler.captured_query is None and not deadline.is_set():
                deadline.wait(0.5)
        finally:
            timer.cancel()

        captured = _LoopbackHandler.captured_query
        if captured is None:
            return {
                "error": "timeout",
                "error_description": f"No redirect received within {_LOOPBACK_TIMEOUT_SEC}s.",
            }

        # 4. Verify state (CSRF guard) and pull the code
        if captured.get("state") != state:
            return {
                "error": "state_mismatch",
                "error_description": "Redirect state did not match — possible CSRF or browser-cache replay.",
            }
        if "error" in captured:
            return {
                "error": captured.get("error", "unknown"),
                "error_description": captured.get("error_description", ""),
            }
        code = captured.get("code")
        if not code:
            return {"error": "no_code", "error_description": "Redirect arrived with no auth code."}

        # 5. Exchange the code (plus client_secret) for a token
        body = urllib.parse.urlencode({
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "scope": scope_str,
        })
        if _DEBUG:
            print(f"[debug] POST /token body: {_redact(body, client_secret)}")

        r = httpx.post(
            _TOKEN_URL.format(tenant=tenant),
            content=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        try:
            response = r.json()
        except json.JSONDecodeError:
            return {"error": "non_json_response", "status_code": r.status_code, "body": r.text}

        if _DEBUG:
            preview = {k: v for k, v in response.items() if k != "access_token"}
            print(f"[debug] /token -> {r.status_code} {preview}")

        if r.status_code == 200 and "access_token" in response:
            return response
        return response

    finally:
        server.shutdown()
        server.server_close()


def decode_jwt_payload(token: str) -> dict:
    """Decode the (unverified) JWT payload to read claims like scp/upn/oid."""
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    return json.loads(base64.urlsafe_b64decode(payload_b64))
