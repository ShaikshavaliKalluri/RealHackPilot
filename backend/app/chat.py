"""Organizer Q&A chatbot over the team dataset.

Builds a compact summary of all registered teams, injects it as context,
and asks the LLM to answer the organizer's natural-language question.

The LLM is constrained to return JSON in a fixed shape:
    { "reply": "<natural language>", "team_refs": [<team_id>, ...] }

team_refs lets the frontend render clickable chips that jump to a team
card. Empty list when the question isn't team-specific.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from . import llm as llm_service
from .models import Team

logger = logging.getLogger("chat")


SYSTEM_PROMPT = """You are RealHack Pilot's organizing-team assistant for RealHack 2026 (a RealPage internal hackathon, June 18-19).

You help the organizer understand and act on the team submissions. You have access to a JSON summary of every currently-registered team, included below.

Capabilities you can offer:
- Filter / list / count teams by attributes (completeness, flags, mentor, idea content)
- Summarize patterns or themes across teams
- Draft personalized email content for a specific team
- Compare or rank teams by AI score, completeness, etc.
- Identify outliers, duplicates, or follow-up actions

OUTPUT FORMAT — return JSON in EXACTLY this shape, no other content:
{
  "reply": "<your natural-language answer, plain text, 1-4 short paragraphs. Mention teams by NAME (not numeric id) when relevant.>",
  "team_refs": [<team_id>, ...]
}

team_refs MUST be a list of integer team IDs you specifically reference in the reply, in the order you mention them. If your answer doesn't reference specific teams, use an empty list [].

Rules:
- Use ONLY the data provided. If a team isn't in the data, say so — do not invent.
- Be concrete and concise. For ranked lists, give 5-10 items with one-line reasons.
- For email drafts, output the actual subject + body the organizer can copy.
- Don't editorialize about RealPage business; stay focused on the hackathon data.
- Today's date: 2026-05-20. Hackathon is 2026-06-18 / 06-19."""


def _summarize_team(t: Team) -> dict[str, Any]:
    """Compact, LLM-friendly summary of one team."""
    idea = (t.idea or "").strip()
    if len(idea) > 240:
        idea = idea[:240].rsplit(" ", 1)[0] + "…"
    tools = (t.tools or "").strip()
    if len(tools) > 120:
        tools = tools[:120].rsplit(" ", 1)[0] + "…"
    business_value = (t.business_value or "").strip()
    if len(business_value) > 120:
        business_value = business_value[:120].rsplit(" ", 1)[0] + "…"

    ai = t.ai_scores or {}
    return {
        "id": t.id,
        "name": t.name,
        "mentor": t.mentor_name or None,
        "member_count": len(t.members),
        "completeness": round(t.completeness_score, 2),
        "flags": t.flags or [],
        "ai_overall_score": (ai.get("overall") or {}).get("score"),
        "ai_summary": (ai.get("summary") or "")[:300] or None,
        "idea": idea or None,
        "tools": tools or None,
        "business_value": business_value or None,
    }


def _build_context(teams: list[Team]) -> str:
    """Render the team summary as a single JSON code block for the system prompt."""
    rows = [_summarize_team(t) for t in teams]
    return (
        f"Current teams ({len(rows)} total):\n\n"
        f"```json\n{json.dumps(rows, indent=2)}\n```"
    )


def chat(db: Session, messages: list[dict]) -> dict:
    """Process a chat request.

    `messages` is the conversation so far in OpenAI-style format:
        [{"role": "user" | "assistant", "content": "..."}, ...]

    Returns a dict with:
        reply       — natural-language answer
        team_refs   — list of team IDs the assistant referenced
        provider    — which LLM provider answered (openai | anthropic | mock)
        model       — model name used
        error       — string if something went wrong, else None
    """
    teams = db.query(Team).all()
    context = _build_context(teams)

    system_prompt = SYSTEM_PROMPT + "\n\n" + context

    # Filter the incoming history to roles the LLM expects
    sanitized: list[dict] = [{"role": "system", "content": system_prompt}]
    for m in messages:
        role = m.get("role")
        content = m.get("content", "")
        if role in ("user", "assistant") and content:
            sanitized.append({"role": role, "content": str(content)})

    try:
        result = llm_service.call_json(
            sanitized,
            mock_payload={},
            mock_schema={
                "reply": {"type": "reason", "from": "messages"},
                "team_refs": {"type": "default", "default": []},
            },
            smart=True,
        )
    except llm_service.LLMError as e:
        logger.warning("Chat LLM call failed: %s", e)
        return {
            "reply": f"Sorry — the LLM service is unavailable right now ({e}).",
            "team_refs": [],
            "provider": None,
            "model": None,
            "error": str(e),
        }

    raw_reply = result.data.get("reply", "")
    reply = str(raw_reply).strip() if raw_reply else "(no response)"

    raw_refs = result.data.get("team_refs", []) or []
    team_refs: list[int] = []
    valid_ids = {t.id for t in teams}
    for v in raw_refs:
        try:
            tid = int(v)
        except (TypeError, ValueError):
            continue
        if tid in valid_ids and tid not in team_refs:
            team_refs.append(tid)

    return {
        "reply": reply,
        "team_refs": team_refs,
        "provider": result.provider,
        "model": result.model,
        "error": None,
    }
