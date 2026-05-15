"""AI Judge Assistant — rubric-based pre-scoring for panelists.

Scores each team on the panel rubric (5 axes, 1-5 each):
  - problem_clarity
  - solution_viability
  - industry_readiness
  - roi
  - novelty

If a public GitHub URL is supplied, the LLM is given repo metadata + README
as additional evidence. Panelists can then override any axis with their own
score and comment.

Output stored on Team.judge_scores as JSON with shape:
  {
    "ai":     { axis: { "score": int, "reason": str }, "overall": ..., "headline": str, "scored_at": iso, "provider": str, "model": str },
    "human":  { axis: { "score": int|null, "comment": str|null }, "overall": int|null, "panelist": str|null, "updated_at": iso },
    "github": { ... compact context dict, or {"error": ...} ... } | null
  }
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from .models import Team
from . import llm as llm_service
from . import github as gh

logger = logging.getLogger("judge")


RUBRIC_AXES = (
    ("problem_clarity",    "Is the problem clearly defined, with a real pain point and target user?"),
    ("solution_viability", "Is the proposed solution realistic to build with the team's stated tools and timeline?"),
    ("industry_readiness", "How close is this to something RealPage could actually deploy or productize?"),
    ("roi",                "How tangible is the business impact / ROI? Quantified beats qualitative."),
    ("novelty",            "How differentiated is the idea compared to existing tools or common patterns?"),
)


SYSTEM_PROMPT = """You are an experienced engineering director on a hackathon evaluation panel at RealPage. You're pre-scoring submissions so the panel can focus on the strongest ones during the live demos.

Score 1 (poor) to 5 (excellent). Be calibrated: a generic CRUD with a slick UI is a 2-3, not a 5. Reserve 5 for submissions that demonstrate real depth (architecture, tradeoffs, quantified impact, or genuine novelty).

Output ONLY valid JSON. Each axis needs a short evidence-grounded reason (under 25 words). The headline is a 12-word-max one-liner summarizing the whole submission.

If a GitHub repo summary is provided, weigh it heavily — code presence and quality are stronger signals than the form prose."""


def _build_user_prompt(team: Team, github_ctx: dict | None) -> str:
    submission = {
        "team_name": team.name,
        "idea_or_problem_statement": team.idea or "(empty)",
        "tools_or_tech_stack": team.tools or "(empty)",
        "approach": team.approach or "(empty)",
        "viability": team.viability or "(empty)",
        "business_value": team.business_value or "(empty)",
    }

    parts = [
        "Score this hackathon submission on FIVE axes using the rubric:",
        "",
    ]
    for key, desc in RUBRIC_AXES:
        parts.append(f"  - {key}: {desc}")
    parts.append("")
    parts.append("Return JSON exactly in this shape:")
    parts.append("{")
    for key, _ in RUBRIC_AXES:
        parts.append(f'  "{key}": {{"score": <1-5>, "reason": "<short evidence-cited reason>"}},')
    parts.append('  "overall": <1-5>,')
    parts.append('  "headline": "<<=12 words summarizing the whole submission>"')
    parts.append("}")
    parts.append("")
    parts.append("Submission:")
    parts.append("```json")
    parts.append(json.dumps(submission, indent=2))
    parts.append("```")

    if github_ctx and not github_ctx.get("error"):
        compact = {
            k: github_ctx.get(k)
            for k in ("owner", "repo", "description", "language", "languages", "stars", "forks", "pushed_at", "topics", "license", "readme_excerpt")
            if github_ctx.get(k) is not None
        }
        parts.append("")
        parts.append("GitHub repo context (real code, prefer this over form prose where conflict):")
        parts.append("```json")
        parts.append(json.dumps(compact, indent=2)[:8000])
        parts.append("```")
    elif github_ctx and github_ctx.get("error"):
        parts.append("")
        parts.append(f"(GitHub fetch attempted but failed: {github_ctx['error']})")

    return "\n".join(parts)


def _normalize(data: dict) -> dict:
    out: dict[str, Any] = {}
    for key, _ in RUBRIC_AXES:
        entry = data.get(key, {})
        if isinstance(entry, dict):
            score = entry.get("score")
            reason = entry.get("reason") or ""
        else:
            score, reason = entry, ""
        try:
            score = int(score) if score is not None else None
        except (TypeError, ValueError):
            score = None
        if score is not None:
            score = max(1, min(5, score))
        out[key] = {"score": score, "reason": str(reason)[:240]}
    try:
        overall = int(data.get("overall")) if data.get("overall") is not None else None
    except (TypeError, ValueError):
        overall = None
    if overall is None:
        scores = [out[k]["score"] for k, _ in RUBRIC_AXES if out[k]["score"] is not None]
        overall = round(sum(scores) / len(scores)) if scores else None
    out["overall"] = overall
    out["headline"] = str(data.get("headline") or "")[:140]
    return out


def _mock_payload(team: Team) -> dict:
    return {
        "idea": team.idea or "",
        "tools": team.tools or "",
        "approach": team.approach or "",
        "viability": team.viability or "",
        "business_value": team.business_value or "",
    }


def _mock_schema() -> dict:
    return {
        "problem_clarity":    {"type": "score", "from": "idea", "seed": 1},
        "solution_viability": {"type": "score", "from": "tools", "seed": 2},
        "industry_readiness": {"type": "score", "from": "viability", "seed": 3},
        "roi":                {"type": "score", "from": "business_value", "seed": 4},
        "novelty":            {"type": "score", "from": "idea", "seed": 5},
    }


def ai_judge(team: Team, github_url: str | None = None, smart: bool = True) -> dict:
    """Run the AI judge on a team. Returns the `ai` slice + the github context blob."""
    github_ctx: dict | None = None
    if github_url:
        github_ctx = gh.fetch_context(github_url)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_prompt(team, github_ctx)},
    ]

    try:
        result = llm_service.call_json(
            messages,
            mock_payload=_mock_payload(team),
            mock_schema=_mock_schema(),
            smart=smart,
        )
    except llm_service.LLMError as e:
        logger.warning("Judge AI failed for team %s: %s", team.id, e)
        return {
            "ai": {"error": str(e)},
            "github": github_ctx,
        }

    ai = _normalize(result.data)
    ai["provider"] = result.provider
    ai["model"] = result.model
    ai["scored_at"] = datetime.utcnow().isoformat()
    return {"ai": ai, "github": github_ctx}


def merge_human_scores(existing: dict | None, human_scores: dict, panelist: str | None) -> dict:
    """Merge in human override scores onto the existing judge_scores blob."""
    if existing is None:
        existing = {}
    human: dict[str, Any] = {}
    for key, _ in RUBRIC_AXES:
        entry = human_scores.get(key) or {}
        score = entry.get("score")
        try:
            score = int(score) if score is not None and score != "" else None
        except (TypeError, ValueError):
            score = None
        if score is not None:
            score = max(1, min(5, score))
        human[key] = {"score": score, "comment": str(entry.get("comment") or "")[:240]}
    scores = [human[k]["score"] for k, _ in RUBRIC_AXES if human[k]["score"] is not None]
    human["overall"] = round(sum(scores) / len(scores)) if scores else None
    human["panelist"] = (panelist or "").strip() or None
    human["updated_at"] = datetime.utcnow().isoformat()
    existing["human"] = human
    return existing
