"""Bearer-token validation for RealHack Pilot's API.

Trusts Entra ID's `Assignment Required = Yes` setting on the Enterprise
Application — only members of `AGAa-RealHack-Pilot-Users` ever get a token
issued for our client_id. Therefore validating the token's `aud` (audience)
and `iss` (issuer) is sufficient to authorize the request; we do NOT call
Graph /me/memberOf separately.

Token validation:
  - Decode the JWT signature using Microsoft's tenant JWKS (cached 1 hour)
  - Verify `iss` matches our tenant
  - Verify `aud` is our client_id (or its api://... form)
  - Verify `exp` is in the future
  - Extract user info (oid, preferred_username, name) for audit logging

The /api/me endpoint also fetches the signed-in user's jobTitle + department
from Graph so the dashboard header can show a profile badge.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

logger = logging.getLogger("auth")

_TENANT = settings.azure_tenant_id
_CLIENT_ID = settings.azure_client_id
_JWKS_URL = f"https://login.microsoftonline.com/{_TENANT}/discovery/v2.0/keys"
_ISSUER_V2 = f"https://login.microsoftonline.com/{_TENANT}/v2.0"

# Cache the JWKS for an hour — keys rotate but rarely.
_jwks_cache: dict | None = None
_jwks_cache_expires: float = 0.0


def _get_jwks() -> dict:
    """Fetch (and cache) Microsoft's signing keys for our tenant."""
    global _jwks_cache, _jwks_cache_expires
    now = time.monotonic()
    if _jwks_cache and _jwks_cache_expires > now:
        return _jwks_cache
    r = httpx.get(_JWKS_URL, timeout=10)
    r.raise_for_status()
    _jwks_cache = r.json()
    _jwks_cache_expires = now + 3600
    return _jwks_cache


def _signing_key_for(token: str) -> str:
    """Pick the matching signing key from JWKS based on the token's kid header."""
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    jwks = _get_jwks()
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(key)  # type: ignore[attr-defined]
    raise jwt.InvalidKeyError(f"No matching JWK for kid={kid}")


# Accept either the bare client_id (Graph-style) or `api://<client_id>` (custom-scope-style).
_VALID_AUDIENCES = [_CLIENT_ID, f"api://{_CLIENT_ID}"]


def validate_token(token: str) -> dict:
    """Decode + verify the JWT. Raises jwt.PyJWTError on any failure."""
    key = _signing_key_for(token)
    # Microsoft's Graph access tokens have `aud` = "00000003-0000-0000-c000-000000000046"
    # (Graph's app id), not our client_id, so they CAN'T be used here. Good — that
    # means a leaked Graph token from somewhere else doesn't authorize this app.
    return jwt.decode(
        token,
        key=key,
        algorithms=["RS256"],
        audience=_VALID_AUDIENCES,
        issuer=_ISSUER_V2,
        options={"verify_aud": True, "verify_iss": True, "verify_exp": True},
    )


# ---- FastAPI dependencies ----

_security = HTTPBearer(auto_error=False)


def require_auth(creds: Optional[HTTPAuthorizationCredentials] = Depends(_security)) -> dict:
    """Dependency that 401s if no valid Entra token is present.

    Returns the decoded JWT claims dict on success. Inject as
    `user: dict = Depends(require_auth)` on protected endpoints.
    """
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = validate_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError as e:
        logger.info("Token validation failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return claims


def access_token_from_creds(creds: HTTPAuthorizationCredentials) -> str:
    return creds.credentials


# ---- Graph profile fetch (for /api/me) ----

def fetch_profile(access_token: str) -> dict:
    """Call Graph /me with the user's token and return the relevant subset."""
    try:
        r = httpx.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
    except Exception as e:
        logger.warning("Graph /me call failed: %s", e)
        return {}
    if r.status_code != 200:
        logger.info("Graph /me returned %s: %s", r.status_code, r.text[:200])
        return {}
    return r.json()


def _initials_for(name: str) -> str:
    parts = [p for p in (name or "").split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def build_profile_payload(claims: dict, graph_profile: dict) -> dict:
    """Combine JWT claims with Graph /me data into the shape the frontend expects."""
    name = (
        graph_profile.get("displayName")
        or claims.get("name")
        or claims.get("preferred_username", "Unknown")
    )
    email = (
        graph_profile.get("mail")
        or graph_profile.get("userPrincipalName")
        or claims.get("preferred_username")
        or claims.get("upn")
        or ""
    )
    return {
        "name": name,
        "email": email,
        "job_title": graph_profile.get("jobTitle"),
        "department": graph_profile.get("department"),
        "initials": _initials_for(name),
    }
