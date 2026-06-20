"""Live panel scoring system: judges submit per-team scores per round.

Three rounds, progressive shortlist. Each judge can score a given team
exactly once per round (DB-level unique constraint). Organizers can enter
scores on behalf of a judge if the judge cannot do so themselves.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .models import Judge, JudgeScore, Team
from .schemas import JUDGE_RUBRIC_KEYS, JUDGE_RUBRIC_WEIGHTS


def normalize_scores(scores: dict) -> dict[str, int]:
    """Coerce every axis to int in [0, 10]. Drops unknown keys."""
    out: dict[str, int] = {}
    for key in JUDGE_RUBRIC_KEYS:
        v = scores.get(key)
        try:
            n = int(v) if v is not None and v != "" else 0
        except (TypeError, ValueError):
            n = 0
        out[key] = max(0, min(10, n))
    return out


def submit_score(
    db: Session,
    judge_id: int,
    team_id: int,
    round_num: int,
    scores: dict,
    comment: str | None,
    entered_by_email: str | None,
) -> JudgeScore:
    """Insert or update a judge score (idempotent by unique constraint)."""
    if round_num not in (1, 2):
        raise ValueError(f"round must be 1 or 2 (got {round_num})")

    normalized = normalize_scores(scores)
    # Weighted total on a 0-100 scale. Each axis is 0-10; we multiply by its
    # weight (% of total) and divide by 10. With weights 30/30/40 and max
    # scores 10/10/10, the total tops out at 100. Stored as int -- truncation
    # is fine because the per-axis raw scores stay in JudgeScore.scores for
    # exact reproduction if we ever need to recompute.
    total = sum(normalized[k] * JUDGE_RUBRIC_WEIGHTS.get(k, 0) for k in JUDGE_RUBRIC_KEYS) // 10

    existing = db.execute(
        select(JudgeScore).where(
            JudgeScore.judge_id == judge_id,
            JudgeScore.team_id == team_id,
            JudgeScore.round == round_num,
        )
    ).scalar_one_or_none()

    if existing:
        existing.scores = normalized
        existing.comment = (comment or "")[:2000] or None
        existing.total = total
        existing.entered_by_email = entered_by_email
        record = existing
    else:
        record = JudgeScore(
            judge_id=judge_id,
            team_id=team_id,
            round=round_num,
            scores=normalized,
            comment=(comment or "")[:2000] or None,
            total=total,
            entered_by_email=entered_by_email,
        )
        db.add(record)

    db.flush()
    return record


def leaderboard(db: Session, round_num: int) -> list[dict]:
    """Aggregate scores by team for a given round."""
    teams = db.query(Team).all()
    judges_by_id = {j.id: j for j in db.query(Judge).all()}

    rows_q = (
        db.query(JudgeScore)
          .filter(JudgeScore.round == round_num)
          .all()
    )

    by_team: dict[int, list[JudgeScore]] = defaultdict(list)
    for r in rows_q:
        by_team[r.team_id].append(r)

    out: list[dict] = []
    for t in teams:
        rs = by_team.get(t.id, [])
        if not rs:
            out.append({
                "team_id": t.id,
                "team_name": t.name,
                "judge_count": 0,
                "total_sum": 0,
                "avg_score": 0.0,
                "per_axis_avg": {k: 0.0 for k in JUDGE_RUBRIC_KEYS},
                "comments": [],
                "per_judge": [],
            })
            continue

        total_sum = sum(r.total for r in rs)
        avg_score = total_sum / len(rs)
        axis_avg: dict[str, float] = {}
        for key in JUDGE_RUBRIC_KEYS:
            vals = [r.scores.get(key, 0) for r in rs if r.scores]
            axis_avg[key] = (sum(vals) / len(vals)) if vals else 0.0

        comments = []
        # Per-judge breakdown -- one entry per JudgeScore row, with the
        # raw axis scores and the contribution of each axis to the weighted
        # total. The frontend renders this as an expandable audit-trail of
        # 'how the final number was computed' for transparency.
        per_judge: list[dict] = []
        for r in rs:
            j = judges_by_id.get(r.judge_id)
            judge_name = j.name if j else f"Judge #{r.judge_id}"
            if r.comment and r.comment.strip():
                comments.append({"judge_name": judge_name, "comment": r.comment})
            scores_dict = r.scores or {}
            axis_breakdown = []
            for key in JUDGE_RUBRIC_KEYS:
                raw = int(scores_dict.get(key) or 0)
                weight = JUDGE_RUBRIC_WEIGHTS.get(key, 0)
                # contribution = raw * weight / 10 (matches submit_score
                # total formula). Storing it explicitly so the UI can show
                # the row 'raw × weight / 10 = contribution' without
                # recomputing in JS.
                axis_breakdown.append({
                    "key": key,
                    "raw": raw,
                    "weight_pct": weight,
                    "contribution": raw * weight // 10,
                })
            per_judge.append({
                "judge_id": r.judge_id,
                "judge_name": judge_name,
                "weighted_total": r.total,
                "axis_breakdown": axis_breakdown,
                "comment": r.comment or None,
                "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
                "entered_by_email": r.entered_by_email,
            })

        out.append({
            "team_id": t.id,
            "team_name": t.name,
            "judge_count": len(rs),
            "total_sum": total_sum,
            # 3-decimal rounding -- gives organizers finer tie-breaking
            # without going full float; matters at the top of the leaderboard
            # where two teams may sit within ~0.5 points of each other.
            "avg_score": round(avg_score, 3),
            "per_axis_avg": {k: round(v, 3) for k, v in axis_avg.items()},
            "comments": comments,
            "per_judge": per_judge,
        })

    # Rank by average weighted score, not by total_sum. Sorting on total_sum
    # would unfairly advantage teams that happened to get more judges. Tie-
    # break by total_sum (more judges = more confident signal), then team name.
    out.sort(key=lambda r: (-r["avg_score"], -r["total_sum"], r["team_name"]))
    return out


def upsert_judge_by_email(db: Session, name: str, email: str | None, role: str = "judge", ado_id: str | None = None) -> Judge:
    """Idempotent judge creation — used by the mock SSO, MSAL login, bulk-add
    and the seed flow. Email comparison is case-insensitive so signing in as
    'Amit.Sareen@RealPage.com' resolves the same row as 'amit.sareen@realpage.com';
    new rows always store the email lowercased to keep the data normalized."""
    judge: Judge | None = None
    email_norm = email.strip().lower() if email else None
    if email_norm:
        judge = db.query(Judge).filter(func.lower(Judge.email) == email_norm).first()
    if not judge and ado_id:
        judge = db.query(Judge).filter(Judge.ado_id == ado_id).first()
    if not judge:
        judge = Judge(name=name, email=email_norm, ado_id=ado_id, role=role)
        db.add(judge)
        db.flush()
    else:
        if not judge.name and name:
            judge.name = name
        # Normalize a previously mixed-case email to lowercase so future
        # equality checks (and Excel-paste lookups) match without func.lower.
        if email_norm and judge.email and judge.email != email_norm:
            judge.email = email_norm
    return judge
