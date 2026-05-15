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
from .schemas import JUDGE_RUBRIC_KEYS


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
    if round_num not in (1, 2, 3):
        raise ValueError(f"round must be 1, 2, or 3 (got {round_num})")

    normalized = normalize_scores(scores)
    total = sum(normalized.values())

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
            })
            continue

        total_sum = sum(r.total for r in rs)
        avg_score = total_sum / len(rs)
        axis_avg: dict[str, float] = {}
        for key in JUDGE_RUBRIC_KEYS:
            vals = [r.scores.get(key, 0) for r in rs if r.scores]
            axis_avg[key] = (sum(vals) / len(vals)) if vals else 0.0

        comments = []
        for r in rs:
            if r.comment and r.comment.strip():
                j = judges_by_id.get(r.judge_id)
                comments.append({
                    "judge_name": j.name if j else f"judge#{r.judge_id}",
                    "comment": r.comment,
                })

        out.append({
            "team_id": t.id,
            "team_name": t.name,
            "judge_count": len(rs),
            "total_sum": total_sum,
            "avg_score": round(avg_score, 2),
            "per_axis_avg": {k: round(v, 2) for k, v in axis_avg.items()},
            "comments": comments,
        })

    out.sort(key=lambda r: (-r["total_sum"], -r["avg_score"], r["team_name"]))
    return out


def upsert_judge_by_email(db: Session, name: str, email: str | None, role: str = "judge", ado_id: str | None = None) -> Judge:
    """Idempotent judge creation — used by the mock SSO and the seed flow."""
    judge: Judge | None = None
    if email:
        judge = db.query(Judge).filter(Judge.email == email).first()
    if not judge and ado_id:
        judge = db.query(Judge).filter(Judge.ado_id == ado_id).first()
    if not judge:
        judge = Judge(name=name, email=email, ado_id=ado_id, role=role)
        db.add(judge)
        db.flush()
    else:
        # Update name only if it's currently blank
        if not judge.name and name:
            judge.name = name
    return judge
