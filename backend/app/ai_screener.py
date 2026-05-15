"""LLM-based screening that complements the rules-based screener.

Produces per-team scores on:
  - genuineness:        is this a real attempt vs placeholder/low-effort?
  - solution_clarity:   does the approach / tech-stack actually describe HOW?
  - business_value:     is the impact tangible and ROI articulated?
  - novelty:            is the idea differentiated from common patterns?

Each score is 1..5 with a one-line reason. Output is stored on Team.ai_scores
as JSON and rendered on the team card.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Iterable

from sqlalchemy.orm import Session

from . import llm as llm_service
from .models import Team

logger = logging.getLogger("ai_screener")


SYSTEM_PROMPT = """You are an internal evaluator screening hackathon team submissions for a property-management software company (RealPage).

For each submission, you produce TWO things:

1. A SHORT NEUTRAL SUMMARY of what the team is pitching — 2 to 3 sentences, no judgment, just a condensed version of the team's own words. Audience: a panelist who has 30 seconds to grasp the team's idea before they present. Cover: the problem they're solving, their proposed solution, and the intended business outcome. Be specific. Do NOT include your evaluation here.

2. Scores on FOUR axes, 1 (poor) to 5 (excellent). Be PRAGMATIC — a 4 or 5 is reserved for submissions that are clearly substantive and specific.

Return ONLY valid JSON in the exact schema requested. Do not add commentary outside the JSON.

Scoring rubric:
- genuineness: Is the submission a real attempt? Empty fields, "TBD", or one-liners → 1. Vague restating of the form prompt → 2. Some specifics → 3. Detailed and on-topic → 4. Clearly invested with specifics, examples, or domain reasoning → 5.
- solution_clarity: Does the approach / tools section describe HOW the team will build it? Missing → 1. Hand-wavy → 2. Names tools but no architecture → 3. Names tools + rough flow → 4. Specific architecture + tradeoffs → 5.
- business_value: Is the business outcome / ROI to RealPage tangible? Missing → 1. Generic ("save time") → 2. Names a stakeholder → 3. Names a metric → 4. Quantifies impact → 5.
- novelty: How differentiated is this from a generic CRUD / dashboard / chatbot? Trivial → 1. Common → 2. Familiar with a twist → 3. Notable angle → 4. Genuinely novel → 5.

Each axis must have a one-sentence reason explaining the score, citing evidence from the submission. Keep reasons under 20 words."""


def _prompt_for(team: Team) -> list[dict]:
    submission = {
        "team_name": team.name,
        "idea_or_problem_statement": team.idea or "(empty)",
        "tools_or_tech_stack": team.tools or "(empty)",
        "approach": team.approach or "(empty)",
        "viability": team.viability or "(empty)",
        "business_value": team.business_value or "(empty)",
    }
    user_msg = (
        "Summarize and score this submission. Return JSON exactly in this shape:\n"
        '{\n'
        '  "summary": "<2-3 neutral sentences describing the problem, solution, and intended outcome — no judgment>",\n'
        '  "genuineness": {"score": <1-5>, "reason": "<one short sentence>"},\n'
        '  "solution_clarity": {"score": <1-5>, "reason": "<one short sentence>"},\n'
        '  "business_value": {"score": <1-5>, "reason": "<one short sentence>"},\n'
        '  "novelty": {"score": <1-5>, "reason": "<one short sentence>"},\n'
        '  "overall": {"score": <1-5>, "headline": "<<=12 words summary>"}\n'
        '}\n\n'
        f"Submission:\n```json\n{json.dumps(submission, indent=2)}\n```"
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]


def _mock_schema() -> dict:
    return {
        "genuineness": {"type": "score", "from": "idea", "seed": 1},
        "solution_clarity": {"type": "score", "from": "tools", "seed": 2},
        "business_value": {"type": "score", "from": "business_value", "seed": 3},
        "novelty": {"type": "score", "from": "idea", "seed": 4},
    }


def _mock_payload(team: Team) -> dict:
    return {
        "idea": team.idea or "",
        "tools": team.tools or "",
        "approach": team.approach or "",
        "viability": team.viability or "",
        "business_value": team.business_value or "",
    }


def _normalize(data: dict) -> dict:
    """Coerce LLM output into a stable shape, tolerating slight schema drift."""
    out: dict = {}

    # Summary (neutral; safe to show judges)
    summary_raw = data.get("summary", "")
    if isinstance(summary_raw, dict):
        summary_raw = summary_raw.get("text") or ""
    out["summary"] = str(summary_raw or "").strip()[:800]

    for axis in ("genuineness", "solution_clarity", "business_value", "novelty"):
        entry = data.get(axis, {})
        if isinstance(entry, dict):
            score = entry.get("score")
            reason = entry.get("reason") or ""
        else:
            score = entry
            reason = ""
        try:
            score = int(score) if score is not None else None
        except (TypeError, ValueError):
            score = None
        if score is not None:
            score = max(1, min(5, score))
        out[axis] = {"score": score, "reason": str(reason)[:200]}

    overall = data.get("overall", {})
    if isinstance(overall, dict):
        try:
            o_score = int(overall.get("score")) if overall.get("score") is not None else None
        except (TypeError, ValueError):
            o_score = None
        if o_score is None:
            scores = [out[a]["score"] for a in ("genuineness", "solution_clarity", "business_value", "novelty") if out[a]["score"] is not None]
            o_score = round(sum(scores) / len(scores)) if scores else None
        out["overall"] = {"score": o_score, "headline": str(overall.get("headline") or "")[:120]}
    else:
        scores = [out[a]["score"] for a in ("genuineness", "solution_clarity", "business_value", "novelty") if out[a]["score"] is not None]
        out["overall"] = {
            "score": round(sum(scores) / len(scores)) if scores else None,
            "headline": "",
        }
    return out


def score_team(team: Team) -> dict:
    """Score a single team. Returns a dict suitable for Team.ai_scores."""
    try:
        result = llm_service.call_json(
            _prompt_for(team),
            mock_payload=_mock_payload(team),
            mock_schema=_mock_schema(),
            smart=False,
        )
    except llm_service.LLMError as e:
        logger.warning("AI screen failed for team %s: %s", team.id, e)
        return {"error": str(e), "provider": None, "model": None, "scored_at": None}

    normalized = _normalize(result.data)
    normalized["provider"] = result.provider
    normalized["model"] = result.model
    normalized["scored_at"] = datetime.utcnow().isoformat()
    return normalized


def score_all(db: Session, teams: Iterable[Team] | None = None, force: bool = False) -> dict:
    """Score every team (or a subset). By default skips teams that already have AI scores."""
    if teams is None:
        teams = db.query(Team).all()
    scored = 0
    skipped = 0
    failed = 0
    provider_counts: dict[str, int] = {}
    for t in teams:
        if not force and t.ai_scores and t.ai_scores.get("overall", {}).get("score"):
            skipped += 1
            continue
        result = score_team(t)
        t.ai_scores = result
        if result.get("error"):
            failed += 1
        else:
            scored += 1
            p = result.get("provider") or "unknown"
            provider_counts[p] = provider_counts.get(p, 0) + 1
    db.flush()
    return {
        "scored": scored,
        "skipped": skipped,
        "failed": failed,
        "providers": provider_counts,
    }
