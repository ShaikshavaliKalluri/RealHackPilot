"""Minimal public-GitHub fetcher for the AI Judge.

Pulls repo metadata + README from a public GitHub URL so the LLM has real
context to evaluate against. Unauthenticated — 60 req/hr/IP, fine for demo.
"""
from __future__ import annotations

import base64
import re
from urllib.parse import urlparse

import httpx


_REPO_RE = re.compile(r"^https?://(?:www\.)?github\.com/([^/]+)/([^/#?]+)", re.I)


def parse_repo(url: str) -> tuple[str, str] | None:
    if not url:
        return None
    m = _REPO_RE.match(url.strip())
    if not m:
        return None
    owner, repo = m.group(1), m.group(2)
    repo = repo.removesuffix(".git")
    return owner, repo


def fetch_context(url: str) -> dict:
    """Return a compact context dict for the AI Judge. On any failure, returns {"error": ...}."""
    parsed = parse_repo(url)
    if not parsed:
        return {"error": "not a recognizable GitHub repo URL"}
    owner, repo = parsed

    out: dict = {"owner": owner, "repo": repo}
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "RealHackPilot/0.1"}
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            meta = client.get(f"https://api.github.com/repos/{owner}/{repo}", headers=headers)
            if meta.status_code == 404:
                return {"error": "repo not found or private", "owner": owner, "repo": repo}
            if meta.status_code == 403:
                return {"error": "GitHub rate-limited or forbidden", "owner": owner, "repo": repo}
            meta.raise_for_status()
            m = meta.json()
            out.update({
                "description": m.get("description"),
                "language": m.get("language"),
                "stars": m.get("stargazers_count"),
                "forks": m.get("forks_count"),
                "open_issues": m.get("open_issues_count"),
                "created_at": m.get("created_at"),
                "pushed_at": m.get("pushed_at"),
                "default_branch": m.get("default_branch"),
                "license": (m.get("license") or {}).get("spdx_id"),
                "topics": m.get("topics", []),
                "homepage": m.get("homepage"),
                "html_url": m.get("html_url"),
            })

            # README (best effort)
            try:
                readme = client.get(f"https://api.github.com/repos/{owner}/{repo}/readme", headers=headers)
                if readme.status_code == 200:
                    r = readme.json()
                    content = r.get("content", "")
                    if r.get("encoding") == "base64" and content:
                        decoded = base64.b64decode(content).decode("utf-8", errors="replace")
                        # Trim to keep prompt size reasonable
                        out["readme_excerpt"] = decoded[:6000]
            except Exception:
                pass

            # Languages breakdown
            try:
                langs = client.get(f"https://api.github.com/repos/{owner}/{repo}/languages", headers=headers)
                if langs.status_code == 200:
                    out["languages"] = langs.json()
            except Exception:
                pass

    except httpx.HTTPError as e:
        return {"error": f"GitHub fetch failed: {e}", "owner": owner, "repo": repo}

    return out
