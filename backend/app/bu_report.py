"""RealPage BU leadership report generation.

Every RealHack idea is classified into ONE of the six RealPage business
units (plus a cross-cutting catch-all) with a short list of sub-tags drawn
from the divisions inside that BU. The report then gets:
  - a 2-3 sentence leadership-facing summary of the idea
  - an AI feasibility+impact score /10
  - a judge-feedback synthesis (only for standouts, to protect low-scoring
    teams from candid judge comments flowing upward)

The output feeds a print-to-PDF friendly HTML view that senior leaders can
scan by BU to spot ideas relevant to their org.

Taxonomy is grounded in the official "RealPage Product Training v2.0"
deck -- see the BU_TAXONOMY constant below.
"""
from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from . import models
from .llm import LLMError, call_text, call_json


logger = logging.getLogger("bu_report")


# ============================================================================
# BU + division taxonomy -- grounded in RealPage Product Training v2.0 deck
# ============================================================================

BU_TAXONOMY: dict[str, dict[str, Any]] = {
    "property_renters_management": {
        "display": "Property & Renters Management",
        "description": (
            "Software for property managers, leasing agents, and rental owners. "
            "Covers the entire prospect-to-resident journey on the operator side: "
            "marketing, CRM, leasing, screening, and the OneSite property "
            "management platform (config, occupancy, accounting, compliance)."
        ),
        "sub_tags": [
            # Front Office
            "marketing", "seo_digital_attribution", "knock_crm", "online_leasing", "screening",
            # OneSite / Property Management
            "onesite_configuration", "account_lead_management", "occupancy_management",
            "accounts_receivable", "document_management", "affordable_housing_regulated",
            "facilities_maintenance",
        ],
    },
    "resident_solutions": {
        "display": "Resident Solutions",
        "description": (
            "Software for the resident (renter). Streamlines payments, "
            "communication, and engagement. Includes the LOFT resident portal, "
            "Moving experience, RealPage Payments / ClickPay, Renters Insurance "
            "products, and Loyalty."
        ),
        "sub_tags": [
            "loft_resident_portal", "moving", "payments_clickpay",
            "renters_insurance", "loft_loyalty", "community_engagement",
        ],
    },
    "business_services": {
        "display": "Business Services",
        "description": (
            "Financial and operational services offered to property clients: "
            "Utility Management (RUM: billing, submetering, expense tracking, "
            "sustainability/ESG) and Spend Management (budgeting, vendor, "
            "invoice processing, spend analytics)."
        ),
        "sub_tags": [
            "utility_management_rum", "submetering", "sustainability_esg",
            "spend_management", "budgeting_forecasting", "vendor_management",
            "invoice_processing", "spend_analytics",
        ],
    },
    "data_analytics": {
        "display": "Data Analytics",
        "description": (
            "Data platforms, BI, and market intelligence: Business Intelligence "
            "(dashboards, benchmarking, scorecards), Market Analytics (formerly "
            "Axiometrics: lease transaction data, submarket forecasting, "
            "competitor analysis), Investment Management (AIM/IMS/DMS/Financial "
            "Modeling), and Revenue Management (dynamic pricing, forecasting, "
            "portfolio optimization)."
        ),
        "sub_tags": [
            "business_intelligence", "market_analytics_axiometrics",
            "investment_management", "revenue_management",
            "dynamic_pricing", "forecasting", "benchmarking",
            "ai_ml_platform",
        ],
    },
    "mixed_use": {
        "display": "Mixed Use",
        "description": (
            "Property management for assets that combine multiple property "
            "types (residential + retail + office + commercial). Products: "
            "Buildium (multi-family, SMB), Home Wise Docs (HOA/COA resale "
            "disclosure), Propertyware (single-family), PEX (UK PRS / "
            "build-to-rent)."
        ),
        "sub_tags": [
            "buildium", "home_wise_docs", "propertyware", "pex",
            "multi_asset_class", "single_family", "hoa_coa",
        ],
    },
    "smart_building": {
        "display": "Smart Building",
        "description": (
            "IoT and connected-living platforms: STRATIS IoT (locks, "
            "thermostats, lighting, leak sensors, submeters, predictive "
            "maintenance) and WhiteSky Managed Wi-Fi."
        ),
        "sub_tags": [
            "stratis_iot", "whitesky_wifi", "access_control", "energy_optimization",
            "predictive_maintenance", "leak_detection", "smart_hvac_lighting",
        ],
    },
    "cross_cutting": {
        "display": "Cross-Cutting / Platform",
        "description": (
            "Ideas that don't cleanly map to one BU: internal developer tooling, "
            "general AI platforms, security/compliance shared services, or "
            "ideas that span multiple BUs equally."
        ),
        "sub_tags": [
            "developer_tooling", "internal_ai_platform", "security_compliance",
            "cross_bu_integration", "observability", "automation_framework",
        ],
    },
}

BU_KEYS = list(BU_TAXONOMY.keys())

# Function sub-tags cross-cut every BU (they describe the *type of work*,
# not the product area). Kept separate so the LLM can pick both a
# product-oriented tag (e.g. 'knock_crm') AND a function tag ('dev').
FUNCTION_TAGS = [
    "dev", "qa", "architecture", "product", "ops",
    "security", "ux", "data_eng", "ai_ml",
]

# Theme sub-tags describe the *approach*. Also cross-cutting.
THEME_TAGS = [
    "agentic_ai", "automation", "analytics", "integration",
    "ux_improvement", "mobile", "ai_copilot", "workflow",
    "self_service", "gen_ai",
]


def bu_display(key: str) -> str:
    """Human-readable BU name for a taxonomy key. Falls back to the key
    itself for unknown values (shouldn't happen in practice)."""
    return BU_TAXONOMY.get(key, {}).get("display") or key.replace("_", " ").title()


# ============================================================================
# LLM prompts
# ============================================================================

def _classify_prompt_system() -> str:
    bu_lines = []
    for key, meta in BU_TAXONOMY.items():
        bu_lines.append(f"- **{key}** ({meta['display']}): {meta['description']}")
        bu_lines.append(f"  Sub-tags: {', '.join(meta['sub_tags'])}")
    return (
        "You are classifying internal hackathon ideas at RealPage (a property "
        "management SaaS company) for a leadership-facing report.\n\n"
        "Classify each idea into EXACTLY ONE business unit from this fixed list:\n\n"
        + "\n".join(bu_lines) + "\n\n"
        "In addition, pick up to 3 product/division sub-tags from that BU's list, "
        "up to 2 function tags from " + str(FUNCTION_TAGS) + ", and up to 2 theme "
        "tags from " + str(THEME_TAGS) + ".\n\n"
        "Output STRICT JSON only, no prose: "
        '{"bu": "<key>", "sub_tags": ["...", "..."], '
        '"function_tags": ["...", "..."], "theme_tags": ["...", "..."], '
        '"rationale": "one sentence explaining why this BU"}\n\n'
        "Rules:\n"
        "- Choose the BU by the primary CUSTOMER the idea serves. If it primarily "
        "helps the resident, use 'resident_solutions'; if the property manager or "
        "leasing agent, use 'property_renters_management'.\n"
        "- Use 'cross_cutting' ONLY if the idea is internal tooling or spans multiple "
        "BUs equally with no clear primary. Prefer a specific BU when possible.\n"
        "- All sub_tags / function_tags / theme_tags must come from the fixed lists.\n"
        "- Never invent new keys or BUs."
    )


def _classify_user_msg(team: models.Team) -> str:
    parts = [
        f"Team: {team.name}",
        f"Idea: {(team.idea or '').strip() or '[none provided]'}",
    ]
    if team.approach:
        parts.append(f"Approach: {team.approach.strip()}")
    if team.tools:
        parts.append(f"Tools: {team.tools.strip()}")
    if team.viability:
        parts.append(f"Viability: {team.viability.strip()}")
    if team.business_value:
        parts.append(f"Business value: {team.business_value.strip()}")
    return "\n\n".join(parts)


def _leadership_summary_prompt_system() -> str:
    return (
        "You are writing a 2-3 sentence summary of a RealPage hackathon idea "
        "for senior leadership. Also assign an AI score from 1-10 for its "
        "business potential (feasibility x fit-to-RealPage x differentiation).\n\n"
        "Rules for the SUMMARY:\n"
        "- 2-3 sentences, ~50-80 words.\n"
        "- What the idea does + why it matters to a RealPage BU.\n"
        "- Concrete, avoid hype. Do NOT use phrases like 'revolutionary', "
        "'game-changing', 'cutting-edge'.\n"
        "- Written for a busy VP/EVP -- clear, direct, no jargon they'd need "
        "to Google.\n\n"
        "Rules for the SCORE:\n"
        "- Integer 1-10.\n"
        "- 9-10 = truly standout: clear customer problem, feasible in a "
        "quarter or two, defensible differentiation.\n"
        "- 7-8 = solid: useful, feasible, but not category-defining.\n"
        "- 5-6 = OK: interesting but has gaps in feasibility or fit.\n"
        "- 3-4 = weak: unclear value or hard to execute.\n"
        "- 1-2 = poor: off-strategy or infeasible.\n"
        "- Grade honestly. In a normal distribution most ideas are 5-7. "
        "Do NOT default to 8+.\n\n"
        'Output STRICT JSON only: {"summary": "...", "ai_score_10": <int>}'
    )


def _leadership_summary_user_msg(team: models.Team) -> str:
    parts = [
        f"Team: {team.name}",
        f"Idea: {(team.idea or '').strip() or '[none provided]'}",
    ]
    if team.approach:
        parts.append(f"Approach: {team.approach.strip()}")
    if team.business_value:
        parts.append(f"Business value: {team.business_value.strip()}")
    if team.viability:
        parts.append(f"Viability: {team.viability.strip()}")
    return "\n\n".join(parts)


def _judge_synthesis_prompt_system() -> str:
    return (
        "You are synthesizing what a panel of RealPage judges thought about a "
        "hackathon idea, for a leadership-facing report. Focus purely on the "
        "QUALITATIVE signal -- what the judges liked and what they questioned.\n\n"
        "Rules:\n"
        "- 2-3 sentences, ~50-70 words.\n"
        "- Neutral, factual tone. Not marketing.\n"
        "- Include ONE specific strength the judges called out and ONE concern "
        "or open question if any was raised. If judges were unanimously "
        "positive, say so explicitly and skip the concern.\n"
        "- Never name or attribute any individual judge.\n"
        "- Do NOT invent feedback that isn't grounded in the comments provided.\n"
        "- Do NOT quote judges verbatim -- paraphrase.\n"
        "- Do NOT mention any numeric score, average, percentage, or rating "
        "(e.g. avoid phrases like '73.3', '7.8/10', 'scored high', 'high score', "
        "'strong average'). The leadership doc shows scores separately.\n\n"
        "Output plain text only. No JSON, no preamble."
    )


def _judge_synthesis_user_msg(team_name: str, scores_summary: str, comments: list[str]) -> str:
    # Numeric scores intentionally omitted from the user message. The LLM
    # tends to echo numbers even with a negative instruction; safest is to
    # never let it see them for this specific synthesis. `scores_summary`
    # is retained in the signature for backward compatibility but ignored.
    _ = scores_summary
    comment_block = "\n\n".join(f"- {c}" for c in comments) if comments else "[no comments provided]"
    return (
        f"Team: {team_name}\n\n"
        f"Anonymous judge comments:\n\n{comment_block}"
    )


# ============================================================================
# LLM callers
# ============================================================================

def team_snapshot(team: models.Team) -> dict:
    """Extract the plain-text fields the LLM needs into a dict. Called from
    the request thread before spawning worker threads -- workers should NOT
    touch SQLAlchemy ORM instances since Session/expiration state isn't
    thread-safe."""
    return {
        "id": team.id,
        "name": team.name or "",
        "idea": (team.idea or "").strip(),
        "approach": (team.approach or "").strip(),
        "tools": (team.tools or "").strip(),
        "viability": (team.viability or "").strip(),
        "business_value": (team.business_value or "").strip(),
    }


def _classify_user_msg_from_snap(snap: dict) -> str:
    parts = [
        f"Team: {snap['name']}",
        f"Idea: {snap['idea'] or '[none provided]'}",
    ]
    if snap["approach"]:
        parts.append(f"Approach: {snap['approach']}")
    if snap["tools"]:
        parts.append(f"Tools: {snap['tools']}")
    if snap["viability"]:
        parts.append(f"Viability: {snap['viability']}")
    if snap["business_value"]:
        parts.append(f"Business value: {snap['business_value']}")
    return "\n\n".join(parts)


def classify_snapshot(snap: dict) -> dict:
    """Thread-safe classify: takes a plain dict (from team_snapshot) instead
    of an ORM instance. Returns the dict we persist to Team.bu_classification.

    Raises LLMError on provider failure. Raises ValueError on missing idea.
    """
    if not snap.get("idea"):
        raise ValueError("team has no idea text to classify")
    result = call_json(
        [
            {"role": "system", "content": _classify_prompt_system()},
            {"role": "user", "content": _classify_user_msg_from_snap(snap)},
        ],
        mock_payload={},
        mock_schema={},
        smart=False,
    )
    data = result.data or {}
    bu = data.get("bu")
    if bu not in BU_TAXONOMY:
        logger.warning("classify: unknown bu %r for team %s; using cross_cutting", bu, snap.get("id"))
        bu = "cross_cutting"
    valid_sub = set(BU_TAXONOMY[bu]["sub_tags"])
    sub_tags = [t for t in (data.get("sub_tags") or []) if t in valid_sub][:3]
    function_tags = [t for t in (data.get("function_tags") or []) if t in FUNCTION_TAGS][:2]
    theme_tags = [t for t in (data.get("theme_tags") or []) if t in THEME_TAGS][:2]
    rationale = (data.get("rationale") or "").strip()[:400]
    return {
        "bu": bu,
        "sub_tags": sub_tags,
        "function_tags": function_tags,
        "theme_tags": theme_tags,
        "rationale": rationale,
    }


def classify_team(team: models.Team) -> dict:
    """Legacy ORM-based classify (single team). Retained for callers that
    don't have a pre-extracted snapshot. Delegates to classify_snapshot."""
    return classify_snapshot(team_snapshot(team))


def summarize_snapshot(snap: dict) -> dict:
    """Thread-safe leadership summary. Returns {summary, ai_score_10}."""
    if not snap.get("idea"):
        raise ValueError("team has no idea text to summarize")
    parts = [
        f"Team: {snap['name']}",
        f"Idea: {snap['idea'] or '[none provided]'}",
    ]
    if snap["approach"]:
        parts.append(f"Approach: {snap['approach']}")
    if snap["business_value"]:
        parts.append(f"Business value: {snap['business_value']}")
    if snap["viability"]:
        parts.append(f"Viability: {snap['viability']}")
    user_msg = "\n\n".join(parts)
    result = call_json(
        [
            {"role": "system", "content": _leadership_summary_prompt_system()},
            {"role": "user", "content": user_msg},
        ],
        mock_payload={},
        mock_schema={},
        smart=False,
    )
    data = result.data or {}
    summary = (data.get("summary") or "").strip()
    try:
        score = int(data.get("ai_score_10") or 0)
    except (TypeError, ValueError):
        score = 0
    score = max(1, min(10, score)) if score else 5
    if not summary:
        raise ValueError("empty summary from LLM")
    return {"summary": summary, "ai_score_10": score}


def summarize_team_for_leadership(team: models.Team) -> dict:
    """Return {summary, ai_score_10} for one team. Raises LLMError on
    provider failure."""
    if not (team.idea or "").strip():
        raise ValueError("team has no idea text to summarize")
    result = call_json(
        [
            {"role": "system", "content": _leadership_summary_prompt_system()},
            {"role": "user", "content": _leadership_summary_user_msg(team)},
        ],
        mock_payload={},
        mock_schema={},
        smart=False,
    )
    data = result.data or {}
    summary = (data.get("summary") or "").strip()
    try:
        score = int(data.get("ai_score_10") or 0)
    except (TypeError, ValueError):
        score = 0
    score = max(1, min(10, score)) if score else 5
    if not summary:
        raise ValueError("empty summary from LLM")
    return {"summary": summary, "ai_score_10": score}


def judge_scores_snapshot(rows: list[models.JudgeScore]) -> list[dict]:
    """Extract judge score fields to plain dicts before worker threads use
    them. Same thread-safety rationale as team_snapshot."""
    out = []
    for r in rows:
        out.append({
            "total": int(r.total or 0),
            "scores": dict(r.scores or {}),
            "comment": (r.comment or "").strip() or None,
        })
    return out


def synthesize_from_snapshots(team_name: str, judge_snaps: list[dict]) -> str:
    """Thread-safe judge-feedback synthesis."""
    if not judge_snaps:
        return ""
    comments = [s["comment"] for s in judge_snaps if s.get("comment")]
    axis_totals: dict[str, list[int]] = defaultdict(list)
    totals: list[int] = []
    for s in judge_snaps:
        totals.append(int(s.get("total") or 0))
        for axis, v in (s.get("scores") or {}).items():
            try:
                axis_totals[axis].append(int(v))
            except (TypeError, ValueError):
                continue
    avg_total = round(sum(totals) / len(totals), 1) if totals else 0.0
    axis_avgs = {
        a: round(sum(vs) / len(vs), 1) for a, vs in axis_totals.items() if vs
    }
    axis_line = ", ".join(f"{a}={v}" for a, v in axis_avgs.items()) if axis_avgs else "n/a"
    scores_summary = (
        f"average weighted total = {avg_total}/100 across {len(judge_snaps)} judges. "
        f"Axis averages: {axis_line}."
    )
    try:
        result = call_text(
            [
                {"role": "system", "content": _judge_synthesis_prompt_system()},
                {"role": "user", "content": _judge_synthesis_user_msg(team_name, scores_summary, comments)},
            ],
            smart=False,
        )
    except LLMError as e:
        logger.warning("judge synthesis failed for team %s: %s", team_name, e)
        return ""
    return (result.data.get("text") or "").strip()


def synthesize_judge_feedback(team: models.Team, judge_scores: list[models.JudgeScore]) -> str:
    """Return a 2-3 sentence synthesis of judge feedback for a standout
    team. Uses actual axis scores + comments. Returns empty string if no
    judges have scored yet."""
    if not judge_scores:
        return ""
    comments = [(s.comment or "").strip() for s in judge_scores if (s.comment or "").strip()]
    axis_totals: dict[str, list[int]] = defaultdict(list)
    totals: list[int] = []
    for s in judge_scores:
        totals.append(int(s.total or 0))
        for axis, v in (s.scores or {}).items():
            try:
                axis_totals[axis].append(int(v))
            except (TypeError, ValueError):
                continue
    avg_total = round(sum(totals) / len(totals), 1) if totals else 0.0
    axis_avgs = {
        a: round(sum(vs) / len(vs), 1) for a, vs in axis_totals.items() if vs
    }
    axis_line = ", ".join(f"{a}={v}" for a, v in axis_avgs.items()) if axis_avgs else "n/a"
    scores_summary = (
        f"average weighted total = {avg_total}/100 across {len(judge_scores)} judges. "
        f"Axis averages: {axis_line}."
    )
    try:
        result = call_text(
            [
                {"role": "system", "content": _judge_synthesis_prompt_system()},
                {"role": "user", "content": _judge_synthesis_user_msg(team.name, scores_summary, comments)},
            ],
            smart=False,
        )
    except LLMError as e:
        logger.warning("judge synthesis failed for team %s: %s", team.id, e)
        return ""
    return (result.data.get("text") or "").strip()


# ============================================================================
# Persistence helpers
# ============================================================================

def store_classification(
    db: Session, team: models.Team, cls: dict, *, edited_by: str | None = None, is_edit: bool = False,
) -> dict:
    """Persist a classification onto Team.bu_classification."""
    now = datetime.utcnow().isoformat()
    prior = team.bu_classification or {}
    entry: dict[str, Any] = {
        "bu": cls["bu"],
        "sub_tags": list(cls.get("sub_tags") or []),
        "function_tags": list(cls.get("function_tags") or []),
        "theme_tags": list(cls.get("theme_tags") or []),
        "rationale": cls.get("rationale") or "",
    }
    if is_edit:
        entry["generated_at"] = prior.get("generated_at")
        entry["edited_at"] = now
        entry["edited_by"] = edited_by
    else:
        entry["generated_at"] = now
        entry["edited_at"] = prior.get("edited_at")
        entry["edited_by"] = prior.get("edited_by")
    team.bu_classification = entry
    flag_modified(team, "bu_classification")
    db.commit()
    db.refresh(team)
    return entry


def store_leadership_summary(
    db: Session, team: models.Team, summary_data: dict, *,
    judge_synthesis: str | None = None,
    edited_by: str | None = None, is_edit: bool = False,
) -> dict:
    """Persist a leadership summary onto Team.leadership_summary."""
    now = datetime.utcnow().isoformat()
    prior = team.leadership_summary or {}
    entry: dict[str, Any] = {
        "summary": summary_data["summary"],
        "ai_score_10": int(summary_data["ai_score_10"]),
        "judge_synthesis": judge_synthesis if judge_synthesis is not None else prior.get("judge_synthesis"),
    }
    if is_edit:
        entry["generated_at"] = prior.get("generated_at")
        entry["edited_at"] = now
        entry["edited_by"] = edited_by
    else:
        entry["generated_at"] = now
        entry["edited_at"] = prior.get("edited_at")
        entry["edited_by"] = prior.get("edited_by")
    team.leadership_summary = entry
    flag_modified(team, "leadership_summary")
    db.commit()
    db.refresh(team)
    return entry


# ============================================================================
# Aggregation (per-BU rollup for the leadership doc)
# ============================================================================

def build_report_data(db: Session, round_num: int, bu_filter: str | None = None) -> dict:
    """Assemble the full leadership report structure.

    Every team in a BU is returned in one `teams` list, sorted by AI score
    desc. There's no longer a standouts / long_tail split -- leadership
    wanted every idea surfaced equally with its own judge synthesis.

    When `bu_filter` is provided (one of BU_KEYS), only that BU's block is
    returned in `bus` -- used by the per-BU PPTX download.

    Shape:
      {
        "round": 1,
        "generated_at": ISO,
        "total_teams": N,
        "unclassified_count": M,
        "bus": [
          {
            "key": "resident_solutions",
            "display": "Resident Solutions",
            "description": "...",
            "team_count": N,
            "avg_ai_score": 6.4,
            "top_sub_tags": [("loft_portal", 5), ...],
            "top_function_tags": [...],
            "top_theme_tags": [...],
            "teams": [ team_block, ... ],   # every team, sorted by AI score desc
          },
          ...
        ]
      }
    """
    all_teams: list[models.Team] = (
        db.query(models.Team)
        .filter(models.Team.idea.isnot(None))
        .filter(models.Team.idea != "")
        .order_by(models.Team.name)
        .all()
    )
    by_bu: dict[str, list[models.Team]] = defaultdict(list)
    unclassified: list[models.Team] = []
    for t in all_teams:
        cls = t.bu_classification or {}
        bu = cls.get("bu")
        if bu in BU_TAXONOMY:
            by_bu[bu].append(t)
        else:
            unclassified.append(t)

    bu_blocks: list[dict[str, Any]] = []
    for bu_key in BU_KEYS:
        if bu_filter and bu_key != bu_filter:
            continue
        teams_in_bu = by_bu.get(bu_key, [])
        team_blocks = [_team_block(t, round_num=round_num) for t in teams_in_bu]
        # Sort by AI score desc, name asc for stable output.
        team_blocks.sort(key=lambda b: (-(b["ai_score_10"] or 0), b["team_name"].lower()))

        sub_counter: Counter[str] = Counter()
        fn_counter: Counter[str] = Counter()
        th_counter: Counter[str] = Counter()
        score_sum, score_n = 0, 0
        for t in teams_in_bu:
            cls = t.bu_classification or {}
            sub_counter.update(cls.get("sub_tags") or [])
            fn_counter.update(cls.get("function_tags") or [])
            th_counter.update(cls.get("theme_tags") or [])
            ldr = t.leadership_summary or {}
            score = ldr.get("ai_score_10")
            if isinstance(score, int) and score:
                score_sum += score
                score_n += 1

        bu_blocks.append({
            "key": bu_key,
            "display": BU_TAXONOMY[bu_key]["display"],
            "description": BU_TAXONOMY[bu_key]["description"],
            "team_count": len(teams_in_bu),
            "avg_ai_score": round(score_sum / score_n, 1) if score_n else None,
            "top_sub_tags": sub_counter.most_common(5),
            "top_function_tags": fn_counter.most_common(3),
            "top_theme_tags": th_counter.most_common(3),
            "teams": team_blocks,
        })

    return {
        "round": round_num,
        "generated_at": datetime.utcnow().isoformat(),
        "total_teams": len(all_teams),
        "unclassified_count": len(unclassified),
        "unclassified": [_team_block(t, round_num=round_num) for t in unclassified] if not bu_filter else [],
        "bus": bu_blocks,
    }


def _team_block(team: models.Team, round_num: int) -> dict[str, Any]:
    cls = team.bu_classification or {}
    ldr = team.leadership_summary or {}
    return {
        "team_id": team.id,
        "team_name": team.name,
        "mentor_name": team.mentor_name,
        "idea": (team.idea or "").strip(),
        "bu": cls.get("bu"),
        "sub_tags": cls.get("sub_tags") or [],
        "function_tags": cls.get("function_tags") or [],
        "theme_tags": cls.get("theme_tags") or [],
        "rationale": cls.get("rationale") or "",
        "summary": ldr.get("summary") or "",
        "ai_score_10": ldr.get("ai_score_10"),
        "judge_synthesis": ldr.get("judge_synthesis") or "",
        "advanced_to_round": team.advanced_to_round,
    }


def load_judge_scores(db: Session, team_id: int, round_num: int) -> list[models.JudgeScore]:
    return (
        db.query(models.JudgeScore)
        .filter(
            models.JudgeScore.team_id == team_id,
            models.JudgeScore.round == round_num,
        )
        .all()
    )


def load_all_judge_scores(db: Session, team_id: int) -> list[models.JudgeScore]:
    """Load every judge scoring record for this team across all rounds.
    Used by the BU leadership report so the 'Judges said' synthesis
    consolidates R1 + R2 (and any future rounds) feedback for each team,
    giving leaders the full picture in one paragraph."""
    return (
        db.query(models.JudgeScore)
        .filter(models.JudgeScore.team_id == team_id)
        .all()
    )
