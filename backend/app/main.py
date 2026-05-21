from __future__ import annotations

import logging
import os
import shutil
import tempfile
import threading
import uuid
from collections import Counter
from datetime import datetime
from typing import Any

import csv
import io

from fastapi import FastAPI, File, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .db import Base, SessionLocal, engine, get_db, lightweight_migrate
from . import models
from .importer import parse_workbook, dicts_to_models
from .screener import screen_all
from .ai_screener import score_all as ai_score_all, score_team as ai_score_team
from .emails import TEMPLATES as EMAIL_TEMPLATES, render_many as render_emails
from .judge import ai_judge, merge_human_scores
from . import judging
from . import comms
from . import backup as backup_service
from . import llm as llm_service
from . import chat as chat_service
from .auth import require_auth, fetch_profile, build_profile_payload
from fastapi import Security
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer_scheme = HTTPBearer(auto_error=False)
from .schemas import (
    TeamOut, UploadResult, DashboardStats, AIScreenResult,
    EmailTemplateOut, EmailRenderRequest, RenderedEmail,
    JudgeAIRequest, JudgeHumanRequest,
    JudgeOut, JudgeCreate, JudgeScoreSubmit, JudgeScoreOut,
    LeaderboardOut, LeaderboardRow, JUDGE_RUBRIC_AXES,
    CommLogOut, TeamChannelCreateRequest, TeamMessageRequest, BroadcastRequest,
    CommLogCreateRequest, RepoCheckOut, ReadinessFlagsRequest,
    ChatRequest, ChatResponse,
    RoundAdvanceRequest, WinnersSetRequest, RoundSummary,
    TeamPatch, MemberCreate, MemberPatch, MemberOut,
)


app = FastAPI(title="RealHack Pilot API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Auth middleware ----
# Every /api/* request requires a valid Entra Bearer token. Health + docs are
# exempt so monitoring + dev-time exploration still work without sign-in.
_AUTH_EXEMPT_PATHS = {"/api/health", "/docs", "/redoc", "/openapi.json"}


@app.middleware("http")
async def _require_auth_middleware(request, call_next):
    path = request.url.path
    # Allow CORS preflight and exempt paths through without auth
    if request.method == "OPTIONS" or path in _AUTH_EXEMPT_PATHS or not path.startswith("/api/"):
        return await call_next(request)
    auth_header = request.headers.get("Authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return JSONResponse(
            status_code=401,
            content={"detail": "Authentication required"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = auth_header.split(" ", 1)[1].strip()
    try:
        from .auth import validate_token  # local import to avoid circular
        validate_token(token)
    except Exception as e:
        return JSONResponse(
            status_code=401,
            content={"detail": f"Invalid token: {e}"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await call_next(request)


@app.on_event("startup")
def _startup() -> None:
    Base.metadata.create_all(bind=engine)
    lightweight_migrate()
    backup_service.start_scheduler()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "env": settings.app_env}


@app.get("/api/me", response_model=dict)
def me(
    claims: dict = Depends(require_auth),
    creds: HTTPAuthorizationCredentials = Security(_bearer_scheme),
) -> dict:
    """Return the signed-in user's profile: name, email, jobTitle, department.

    Combines JWT claims (authoritative for identity) with Graph /me data
    (jobTitle, department) so the dashboard can show a rich profile badge.
    """
    graph_profile = fetch_profile(creds.credentials) if creds else {}
    return build_profile_payload(claims, graph_profile)


@app.get("/api/llm/health")
def llm_health() -> dict:
    return llm_service.health_check()


@app.get("/api/teams", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db)) -> list[models.Team]:
    return db.query(models.Team).order_by(models.Team.name.asc()).all()


@app.get("/api/stats", response_model=DashboardStats)
def stats(db: Session = Depends(get_db)) -> DashboardStats:
    teams = db.query(models.Team).all()
    total = len(teams)
    complete = sum(1 for t in teams if t.completeness_score >= 0.8 and not (t.flags or []))
    flagged = sum(1 for t in teams if t.flags)

    locations: Counter[str] = Counter()
    sizes: Counter[str] = Counter()
    # Deduped people: lowercased email if available, else lowercased name.
    # This is what the dashboard's "Total unique people" tile reports — a
    # person who appears as both a mentor and a team member only counts once.
    unique_people: set[str] = set()
    for t in teams:
        if t.mentor_email:
            unique_people.add(t.mentor_email.strip().lower())
        elif t.mentor_name:
            unique_people.add(t.mentor_name.strip().lower())
        for m in t.members:
            if m.email:
                unique_people.add(m.email.strip().lower())
            elif m.name:
                unique_people.add(m.name.strip().lower())
            if m.location:
                locations[str(m.location).strip()] += 1
            if m.tshirt_size:
                sizes[str(m.tshirt_size).strip().upper()] += 1

    # Cross-team flags via DB scan
    dup_count = 0
    multi_mentor_count = 0
    for t in teams:
        for f in t.flags or []:
            if f.startswith("duplicate_participant:"):
                dup_count += 1
            if f.startswith("mentor_overloaded:"):
                multi_mentor_count += 1

    return DashboardStats(
        total_teams=total,
        complete_teams=complete,
        flagged_teams=flagged,
        duplicate_participants=dup_count,
        multi_team_mentors=multi_mentor_count,
        locations=dict(locations),
        tshirt_sizes=dict(sizes),
        total_unique_people=len(unique_people),
    )


@app.post("/api/upload", response_model=UploadResult)
async def upload_registrations(
    file: UploadFile = File(...),
    replace: bool = True,
    db: Session = Depends(get_db),
) -> UploadResult:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Expected an .xlsx/.xls file")

    suffix = os.path.splitext(file.filename)[1] or ".xlsx"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        shutil.copyfileobj(file.file, tmp)
        tmp.close()

        team_dicts = parse_workbook(tmp.name)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    skipped = 0
    if replace:
        # Preserve AI scores and organizer-set fields keyed by external_id so
        # they survive the re-upload (TRUNCATE wipes the table but the scores
        # from a previous AI screening run should not be lost).
        preserved: dict[str, dict] = {}
        for existing in db.query(models.Team).all():
            if existing.external_id:
                preserved[existing.external_id] = {
                    "ai_scores": existing.ai_scores,
                    "judge_scores": existing.judge_scores,
                    "advanced_to_round": existing.advanced_to_round,
                    "final_position": existing.final_position,
                    "presentation_uploaded": existing.presentation_uploaded,
                    "repo_url": existing.repo_url,
                    "repo_ready": existing.repo_ready,
                    "repo_check_notes": existing.repo_check_notes,
                    "has_teams_channel": existing.has_teams_channel,
                    "teams_channel_id": existing.teams_channel_id,
                    "teams_channel_created_at": existing.teams_channel_created_at,
                }
        db.execute(text("TRUNCATE TABLE members, teams RESTART IDENTITY CASCADE"))
        db.flush()

    teams = dicts_to_models(team_dicts)
    # Deduplicate on external_id — MS Forms exports occasionally contain duplicate rows.
    seen_ext_ids: set[str] = set()
    unique_teams = []
    for t in teams:
        key = t.external_id or str(id(t))
        if key not in seen_ext_ids:
            seen_ext_ids.add(key)
            unique_teams.append(t)
        else:
            skipped += 1
    teams = unique_teams

    # Restore preserved fields onto matching teams before inserting.
    if replace and preserved:
        for t in teams:
            snap = preserved.get(t.external_id or "")
            if snap:
                if snap["ai_scores"]:
                    t.ai_scores = snap["ai_scores"]
                if snap["judge_scores"]:
                    t.judge_scores = snap["judge_scores"]
                t.advanced_to_round = snap["advanced_to_round"]
                t.final_position = snap["final_position"]
                t.presentation_uploaded = snap["presentation_uploaded"]
                t.repo_url = snap["repo_url"]
                t.repo_ready = snap["repo_ready"]
                t.repo_check_notes = snap["repo_check_notes"]
                t.has_teams_channel = snap["has_teams_channel"]
                t.teams_channel_id = snap["teams_channel_id"]
                t.teams_channel_created_at = snap["teams_channel_created_at"]

    for t in teams:
        db.add(t)
    db.flush()

    summary = screen_all(db)
    db.commit()

    return UploadResult(
        teams_imported=len(teams),
        teams_skipped=skipped,
        duplicate_participants=summary["duplicate_participants"],
        multi_team_mentors=summary["multi_team_mentors"],
    )


@app.post("/api/rescreen", response_model=dict)
def rescreen(db: Session = Depends(get_db)) -> dict:
    summary = screen_all(db)
    db.commit()
    return summary


# ---- AI screening — async background job ----
#
# Bulk AI screening hits the LLM 48× back-to-back and easily blows past
# corporate-LB / nginx timeouts on a single HTTP request. We run it in a
# background thread instead: POST kicks it off and returns a job_id; the
# UI polls GET /api/ai-screen/status every couple of seconds until done.
#
# Single-worker assumption: the systemd unit runs uvicorn with --workers 2,
# so this in-memory state is per-process. Concurrent screening jobs in
# practice never happen (one organizer clicks the button), so the small
# race window if a status check lands on the other worker is acceptable —
# worst case the UI sees stale "idle" for one poll, then catches up.
_ai_screen_logger = logging.getLogger("ai_screen")
# RLock so the same thread can re-enter (e.g. if the handler builds an error
# payload via _ai_screen_status_payload() while still holding the lock).
_ai_screen_lock = threading.RLock()
_ai_screen_state: dict[str, Any] = {
    "running": False,
    "job_id": None,
    "force": False,
    "total": 0,
    "scored": 0,
    "failed": 0,
    "providers": {},
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def _ai_screen_status_payload() -> dict:
    with _ai_screen_lock:
        state = dict(_ai_screen_state)
    if state.get("error"):
        status = "error"
    elif state.get("running"):
        status = "running"
    elif state.get("finished_at"):
        status = "done"
    else:
        status = "idle"
    return {
        "job_id": state.get("job_id"),
        "status": status,
        "total": state.get("total", 0),
        "scored": state.get("scored", 0),
        "failed": state.get("failed", 0),
        "providers": state.get("providers", {}),
        "started_at": state.get("started_at"),
        "finished_at": state.get("finished_at"),
        "error": state.get("error"),
    }


def _run_ai_screen_background(force: bool, job_id: str) -> None:
    """Worker that runs in a background thread.

    Scores teams one at a time so we can publish progress mid-run. Each
    team's score is committed individually so a crash mid-job leaves
    everything before it durably saved.
    """
    try:
        with SessionLocal() as db:
            teams = db.query(models.Team).all()
            scored = 0
            failed = 0
            providers: dict[str, int] = {}
            for t in teams:
                if not force and t.ai_scores and t.ai_scores.get("overall", {}).get("score"):
                    continue
                result = ai_score_team(t)
                t.ai_scores = result
                db.commit()
                if result.get("error"):
                    failed += 1
                else:
                    scored += 1
                    p = result.get("provider") or "unknown"
                    providers[p] = providers.get(p, 0) + 1
                with _ai_screen_lock:
                    _ai_screen_state["scored"] = scored
                    _ai_screen_state["failed"] = failed
                    _ai_screen_state["providers"] = providers
    except Exception as e:  # pragma: no cover — failsafe
        _ai_screen_logger.exception("AI screen background job %s failed", job_id)
        with _ai_screen_lock:
            _ai_screen_state["error"] = str(e)[:200]
    finally:
        with _ai_screen_lock:
            _ai_screen_state["running"] = False
            _ai_screen_state["finished_at"] = datetime.utcnow().isoformat()


@app.post("/api/ai-screen", response_model=dict)
def ai_screen(force: bool = False) -> dict:
    """Start AI screening in the background. Returns immediately with job info.

    Poll GET /api/ai-screen/status to watch progress.
    """
    # Cheap, lockless pre-check — we re-verify under the lock below before mutating
    if _ai_screen_state.get("running"):
        # Build the status payload BEFORE we touch the lock, so we never hold
        # and re-acquire it on the error path.
        existing_status = _ai_screen_status_payload()
        raise HTTPException(
            status_code=409,
            detail={"message": "A screening job is already running", "status": existing_status},
        )

    # Snapshot total team count up-front so the UI has a denominator.
    # This runs outside the lock so a slow DB doesn't block anyone else.
    with SessionLocal() as s:
        total = s.query(models.Team).count()
    job_id = uuid.uuid4().hex[:12]
    started_at = datetime.utcnow().isoformat()

    # Atomic check-then-set: race-safe even if two requests slip past the
    # lockless pre-check at the same time.
    with _ai_screen_lock:
        if _ai_screen_state.get("running"):
            existing_status = _ai_screen_status_payload()
            raise HTTPException(
                status_code=409,
                detail={"message": "A screening job is already running", "status": existing_status},
            )
        _ai_screen_state.update({
            "running": True,
            "job_id": job_id,
            "force": force,
            "total": total,
            "scored": 0,
            "failed": 0,
            "providers": {},
            "started_at": started_at,
            "finished_at": None,
            "error": None,
        })

    threading.Thread(
        target=_run_ai_screen_background,
        args=(force, job_id),
        daemon=True,
        name=f"ai-screen-{job_id}",
    ).start()

    return _ai_screen_status_payload()


@app.get("/api/ai-screen/status", response_model=dict)
def ai_screen_status() -> dict:
    """Current state of the most recent / in-flight AI screening job."""
    return _ai_screen_status_payload()


# ---- Tournament progression (advance teams between rounds, crown winners) ----

@app.post("/api/rounds/advance", response_model=dict)
def advance_round(req: RoundAdvanceRequest, db: Session = Depends(get_db)) -> dict:
    """Mark the listed teams as advanced past from_round into round from_round+1.

    Teams NOT in the list keep their current advanced_to_round — they're
    eliminated by being left behind, not by an explicit demotion. This means
    you can call this endpoint multiple times safely (idempotent for the
    same team_ids; cumulative across different calls).
    """
    if req.from_round not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="from_round must be 1, 2, or 3")
    next_round = req.from_round + 1
    teams = db.query(models.Team).filter(models.Team.id.in_(req.team_ids)).all()
    advanced_ids = []
    for t in teams:
        # Bump only if not already at or past the next round (don't accidentally regress)
        if (t.advanced_to_round or 1) < next_round:
            t.advanced_to_round = next_round
            advanced_ids.append(t.id)
    db.commit()
    return {
        "from_round": req.from_round,
        "to_round": next_round,
        "advanced_team_ids": advanced_ids,
        "advanced_count": len(advanced_ids),
    }


@app.post("/api/rounds/reset/{round}", response_model=dict)
def reset_round_advancements(round: int, db: Session = Depends(get_db)) -> dict:
    """Undo: drop every team's advanced_to_round back to `round` if currently higher.

    Useful when the organizer wants to re-pick the advancing teams for a round.
    Doesn't touch final_position — that's reset via a separate winners call.
    """
    if round not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="round must be 1, 2, or 3")
    teams = db.query(models.Team).filter(models.Team.advanced_to_round > round).all()
    for t in teams:
        t.advanced_to_round = round
    db.commit()
    return {"reset_to_round": round, "teams_reset": len(teams)}


@app.post("/api/rounds/winners", response_model=dict)
def set_winners(req: WinnersSetRequest, db: Session = Depends(get_db)) -> dict:
    """Set 1st / 2nd / 3rd place team IDs. Pass empty positions {} to clear all."""
    # Validate positions
    for pos in req.positions.keys():
        if pos not in ("1", "2", "3"):
            raise HTTPException(status_code=400, detail=f"Position must be '1', '2', or '3'; got {pos}")

    # Clear existing winners first
    for t in db.query(models.Team).filter(models.Team.final_position.isnot(None)).all():
        t.final_position = None

    # Set new winners
    for pos_str, team_id in req.positions.items():
        team = db.query(models.Team).filter(models.Team.id == team_id).first()
        if not team:
            raise HTTPException(status_code=404, detail=f"Team {team_id} not found")
        team.final_position = int(pos_str)
        # Make sure they're at the winner level too
        team.advanced_to_round = max(team.advanced_to_round or 1, 4)
    db.commit()
    return {"positions": req.positions}


@app.get("/api/rounds/summary", response_model=list[RoundSummary])
def round_summary(db: Session = Depends(get_db)) -> list[RoundSummary]:
    """Per-round counts: how many teams eligible, how many already scored."""
    out: list[RoundSummary] = []
    for r in (1, 2, 3):
        eligible = db.query(models.Team).filter(models.Team.advanced_to_round >= r).count()
        scored = (
            db.query(models.JudgeScore.team_id)
            .filter(models.JudgeScore.round == r)
            .distinct()
            .count()
        )
        out.append(RoundSummary(round=r, eligible_team_count=eligible, scored_team_count=scored))
    return out


@app.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(req: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    """Organizer Q&A chatbot over the team dataset.

    Accepts a list of messages (full conversation context) and returns the
    assistant's next reply plus any team IDs the answer references.
    """
    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    result = chat_service.chat(db, messages)
    return ChatResponse(**result)


@app.post("/api/ai-screen/{team_id}", response_model=dict)
def ai_screen_one(team_id: int, db: Session = Depends(get_db)) -> dict:
    team = db.query(models.Team).get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    result = ai_score_team(team)
    team.ai_scores = result
    db.commit()
    return result


@app.get("/api/email/templates", response_model=list[EmailTemplateOut])
def list_email_templates() -> list[EmailTemplateOut]:
    return [
        EmailTemplateOut(id=t.id, label=t.label, description=t.description, audience=t.audience, subject=t.subject)
        for t in EMAIL_TEMPLATES
    ]


@app.post("/api/email/render", response_model=list[RenderedEmail])
def render_email_endpoint(req: EmailRenderRequest, db: Session = Depends(get_db)) -> list[RenderedEmail]:
    try:
        rendered = render_emails(db, req.template_id, req.team_ids)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return [RenderedEmail(**r) for r in rendered]


@app.post("/api/judge/{team_id}/ai", response_model=dict)
def judge_ai_endpoint(team_id: int, req: JudgeAIRequest, db: Session = Depends(get_db)) -> dict:
    team = db.query(models.Team).get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    if req.repo_url is not None:
        team.repo_url = req.repo_url or None
    result = ai_judge(team, github_url=req.repo_url or team.repo_url)
    existing = team.judge_scores or {}
    existing["ai"] = result["ai"]
    existing["github"] = result["github"]
    team.judge_scores = existing
    db.commit()
    return existing


@app.get("/api/export.csv")
def export_csv(db: Session = Depends(get_db)) -> StreamingResponse:
    teams = db.query(models.Team).order_by(models.Team.name.asc()).all()
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    w.writerow([
        "team_name", "mentor_name", "mentor_email",
        "members", "locations", "tshirt_sizes",
        "completeness_pct", "flag_count", "flags",
        "ai_overall", "ai_genuineness", "ai_solution_clarity", "ai_business_value", "ai_novelty",
        "judge_ai_overall", "judge_human_overall", "judge_panelist",
        "idea", "tools", "approach", "viability", "business_value",
        "repo_url",
    ])
    for t in teams:
        ai = t.ai_scores or {}
        js = t.judge_scores or {}
        j_ai = js.get("ai", {}) or {}
        j_h = js.get("human", {}) or {}
        w.writerow([
            t.name,
            t.mentor_name or "",
            t.mentor_email or "",
            " | ".join(m.name for m in t.members),
            " | ".join((m.location or "") for m in t.members),
            " | ".join((m.tshirt_size or "") for m in t.members),
            int(round((t.completeness_score or 0) * 100)),
            len(t.flags or []),
            " | ".join(t.flags or []),
            (ai.get("overall") or {}).get("score", ""),
            (ai.get("genuineness") or {}).get("score", ""),
            (ai.get("solution_clarity") or {}).get("score", ""),
            (ai.get("business_value") or {}).get("score", ""),
            (ai.get("novelty") or {}).get("score", ""),
            j_ai.get("overall", "") if not j_ai.get("error") else "",
            j_h.get("overall", "") or "",
            j_h.get("panelist") or "",
            (t.idea or "").replace("\n", " ").strip(),
            (t.tools or "").replace("\n", " ").strip(),
            (t.approach or "").replace("\n", " ").strip(),
            (t.viability or "").replace("\n", " ").strip(),
            (t.business_value or "").replace("\n", " ").strip(),
            t.repo_url or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="realhack_pilot_export.csv"'},
    )


@app.post("/api/judge/{team_id}/human", response_model=dict)
def judge_human_endpoint(team_id: int, req: JudgeHumanRequest, db: Session = Depends(get_db)) -> dict:
    team = db.query(models.Team).get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    if req.repo_url is not None:
        team.repo_url = req.repo_url or None
    existing = merge_human_scores(team.judge_scores or {}, req.scores, req.panelist)
    team.judge_scores = existing
    db.commit()
    return existing


# ===== Live judge panel scoring (new M4) =====

@app.get("/api/judging/rubric")
def judging_rubric() -> dict:
    return {"axes": [{"key": k, "label": v} for k, v in JUDGE_RUBRIC_AXES], "max_per_axis": 10}


@app.get("/api/judges", response_model=list[JudgeOut])
def list_judges(db: Session = Depends(get_db)) -> list[models.Judge]:
    return db.query(models.Judge).filter(models.Judge.is_active == True).order_by(models.Judge.name.asc()).all()  # noqa: E712


@app.post("/api/judges", response_model=JudgeOut)
def create_judge(req: JudgeCreate, db: Session = Depends(get_db)) -> models.Judge:
    judge = judging.upsert_judge_by_email(db, name=req.name, email=req.email, role=req.role)
    db.commit()
    return judge


@app.post("/api/judges/login", response_model=JudgeOut)
def judge_login(req: JudgeCreate, db: Session = Depends(get_db)) -> models.Judge:
    """Mock SSO: upsert by email, return Judge record."""
    judge = judging.upsert_judge_by_email(db, name=req.name, email=req.email, role=req.role or "judge")
    db.commit()
    return judge


@app.post("/api/judging/scores", response_model=JudgeScoreOut)
def submit_judge_score(req: JudgeScoreSubmit, db: Session = Depends(get_db)) -> models.JudgeScore:
    judge = db.query(models.Judge).get(req.judge_id)
    if not judge:
        raise HTTPException(status_code=404, detail="judge not found")
    team = db.query(models.Team).get(req.team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    try:
        record = judging.submit_score(
            db=db,
            judge_id=req.judge_id,
            team_id=req.team_id,
            round_num=req.round,
            scores=req.scores,
            comment=req.comment,
            entered_by_email=req.entered_by_email,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return record


@app.get("/api/judging/scores", response_model=list[JudgeScoreOut])
def list_judge_scores(
    round: int | None = None,
    judge_id: int | None = None,
    team_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[models.JudgeScore]:
    q = db.query(models.JudgeScore)
    if round is not None:
        q = q.filter(models.JudgeScore.round == round)
    if judge_id is not None:
        q = q.filter(models.JudgeScore.judge_id == judge_id)
    if team_id is not None:
        q = q.filter(models.JudgeScore.team_id == team_id)
    return q.order_by(models.JudgeScore.submitted_at.desc()).all()


@app.delete("/api/judging/scores", response_model=dict)
def delete_judge_score(
    judge_id: int,
    team_id: int,
    round: int,
    db: Session = Depends(get_db),
) -> dict:
    """Delete a single judge-team-round score row.

    Used by JudgeMode's 'Reset my score' action so a judge can correct
    or rescind a score before it's final. Returns {deleted: bool}.
    """
    score = (
        db.query(models.JudgeScore)
        .filter(
            models.JudgeScore.judge_id == judge_id,
            models.JudgeScore.team_id == team_id,
            models.JudgeScore.round == round,
        )
        .first()
    )
    if not score:
        return {"deleted": False, "message": "No score found for this judge/team/round."}
    db.delete(score)
    db.commit()
    return {"deleted": True, "judge_id": judge_id, "team_id": team_id, "round": round}


@app.get("/api/judging/leaderboard", response_model=LeaderboardOut)
def get_leaderboard(round: int = 1, db: Session = Depends(get_db)) -> LeaderboardOut:
    rows = judging.leaderboard(db, round)
    return LeaderboardOut(round=round, rows=[LeaderboardRow(**r) for r in rows])


# ===== Teams comms + audit log =====

@app.get("/api/comms/mode")
def comms_mode() -> dict:
    return {"mode": comms.GRAPH_MODE}


@app.post("/api/comms/channels", response_model=dict)
def create_channels(req: TeamChannelCreateRequest, db: Session = Depends(get_db)) -> dict:
    q = db.query(models.Team)
    if req.team_ids is not None:
        q = q.filter(models.Team.id.in_(req.team_ids))
    teams = q.all()
    created: list[int] = []
    already: list[int] = []
    for t in teams:
        if t.has_teams_channel:
            already.append(t.id)
            continue
        comms.create_team_channel(db, t, sent_by_email=req.sent_by_email)
        created.append(t.id)
    db.commit()
    return {"created": created, "already_existing": already, "mode": comms.GRAPH_MODE}


@app.post("/api/comms/teams/{team_id}/message", response_model=dict)
def post_team_message(team_id: int, req: TeamMessageRequest, db: Session = Depends(get_db)) -> dict:
    team = db.query(models.Team).get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    result = comms.post_team_message(db, team, req.message, sent_by_email=req.sent_by_email)
    db.commit()
    return result


@app.post("/api/comms/broadcast", response_model=dict)
def broadcast_message(req: BroadcastRequest, db: Session = Depends(get_db)) -> dict:
    result = comms.broadcast(db, req.message, team_ids=req.team_ids, sent_by_email=req.sent_by_email)
    db.commit()
    return result


@app.get("/api/comms/log", response_model=list[CommLogOut])
def list_comm_log(
    team_id: int | None = None,
    kind: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
) -> list[models.CommLog]:
    q = db.query(models.CommLog)
    if team_id is not None:
        q = q.filter(models.CommLog.team_id == team_id)
    if kind is not None:
        q = q.filter(models.CommLog.kind == kind)
    return q.order_by(models.CommLog.sent_at.desc()).limit(limit).all()


@app.post("/api/comms/log", response_model=CommLogOut)
def append_comm_log(req: CommLogCreateRequest, db: Session = Depends(get_db)) -> models.CommLog:
    entry = comms.log(
        db,
        team_id=req.team_id,
        kind=req.kind,
        template_id=req.template_id,
        subject=req.subject,
        body=req.body,
        recipients=req.recipients,
        status=req.status,
        sent_by_email=req.sent_by_email,
    )
    db.commit()
    return entry


@app.get("/api/comms/duplicate-check")
def duplicate_check(
    team_id: int,
    kind: str = "email",
    template_id: str | None = None,
    hours: int = 24,
    db: Session = Depends(get_db),
) -> dict:
    entry = comms.recent_duplicate(db, team_id, kind, template_id, hours)
    if not entry:
        return {"duplicate": False}
    return {
        "duplicate": True,
        "last_sent_at": entry.sent_at.isoformat(),
        "last_sent_by_email": entry.sent_by_email,
        "kind": entry.kind,
        "template_id": entry.template_id,
    }


@app.post("/api/teams/{team_id}/check-repo", response_model=RepoCheckOut)
def check_repo(team_id: int, db: Session = Depends(get_db)) -> RepoCheckOut:
    team = db.query(models.Team).get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    result = comms.check_repo_readiness(team)
    db.commit()
    return RepoCheckOut(**result)


# ===== Backups =====

@app.get("/api/backup/status")
def backup_status() -> dict:
    return backup_service.get_status()


@app.get("/api/backup/list")
def backup_list() -> list[dict]:
    return backup_service.list_backups()


@app.post("/api/backup/now")
def backup_now() -> dict:
    return backup_service.do_backup(reason="manual")


@app.get("/api/backup/download/{filename}")
def backup_download(filename: str):
    from pathlib import Path
    if not filename.startswith("realhack_pilot_") or not filename.endswith(".db") or "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="invalid filename")
    path = Path("./backups") / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="backup not found")
    return FileResponse(str(path), media_type="application/x-sqlite3", filename=filename)


@app.get("/api/backup/download-latest")
def backup_download_latest():
    backups = backup_service.list_backups()
    if not backups:
        raise HTTPException(status_code=404, detail="no backups yet")
    return backup_download(backups[0]["filename"])


@app.post("/api/backup/restore/{filename}")
def backup_restore(filename: str) -> dict:
    if not filename.startswith("realhack_pilot_") or not filename.endswith(".db") or "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="invalid filename")
    return backup_service.restore(filename, make_pre_restore_backup=True)


@app.patch("/api/teams/{team_id}/readiness", response_model=TeamOut)
def update_readiness(team_id: int, req: ReadinessFlagsRequest, db: Session = Depends(get_db)) -> models.Team:
    team = db.query(models.Team).get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    if req.presentation_uploaded is not None:
        team.presentation_uploaded = req.presentation_uploaded
    if req.repo_url is not None:
        team.repo_url = req.repo_url or None
    if req.has_teams_channel is not None:
        team.has_teams_channel = req.has_teams_channel
    db.commit()
    db.refresh(team)
    return team


# ===== Team / member edit (post-registration change requests) =====
# Organizers use these to apply approved change requests against teams
# whose MS Forms entry has already been finalized. Every change writes an
# audit row via comms.log() with kind="team_edit" so we have a permanent
# record of who edited what, when, and why.

_EDITABLE_TEAM_FIELDS = (
    "name", "mentor_name", "mentor_email", "mentor_location", "mentor_tshirt_size",
    "mentor_address",
    "idea", "tools", "approach", "viability", "business_value", "repo_url",
)


def _signed_in_email(claims: dict) -> str | None:
    return claims.get("preferred_username") or claims.get("upn") or claims.get("email")


def _audit_team_edit(
    db: Session, *, team_id: int, summary: str, reason: str | None, editor_email: str | None,
) -> None:
    body = summary if not reason else f"{summary}\nReason: {reason}"
    comms.log(
        db, team_id=team_id, kind="team_edit",
        subject="Team data edited via dashboard",
        body=body,
        status="sent",
        sent_by_email=editor_email,
    )


@app.patch("/api/teams/{team_id}", response_model=TeamOut)
def patch_team(
    team_id: int,
    req: TeamPatch,
    db: Session = Depends(get_db),
    claims: dict = Depends(require_auth),
) -> models.Team:
    team = db.query(models.Team).get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")

    changes: list[str] = []
    for field in _EDITABLE_TEAM_FIELDS:
        new_val = getattr(req, field)
        if new_val is None:
            continue
        old_val = getattr(team, field)
        # Normalise empty string → None for nullable text fields (everything
        # except name, which is required).
        normalised = new_val if field == "name" else (new_val or None)
        if normalised != old_val:
            old_display = old_val if old_val is not None else "(empty)"
            new_display = normalised if normalised is not None else "(empty)"
            changes.append(f"{field}: {old_display!r} -> {new_display!r}")
            setattr(team, field, normalised)

    if not changes:
        # No-op patch: nothing changed, don't write an audit row.
        return team

    db.commit()
    db.refresh(team)
    _audit_team_edit(
        db, team_id=team.id,
        summary="Updated fields: " + "; ".join(changes),
        reason=req.edit_reason,
        editor_email=_signed_in_email(claims),
    )
    db.commit()
    return team


@app.post("/api/teams/{team_id}/members", response_model=MemberOut)
def add_member(
    team_id: int,
    req: MemberCreate,
    db: Session = Depends(get_db),
    claims: dict = Depends(require_auth),
) -> models.Member:
    team = db.query(models.Team).get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    if not (req.name or "").strip():
        raise HTTPException(status_code=400, detail="name is required")

    next_pos = max((m.position for m in team.members), default=-1) + 1
    member = models.Member(
        team_id=team.id,
        name=req.name.strip(),
        email=(req.email or "").strip() or None,
        location=(req.location or "").strip() or None,
        tshirt_size=(req.tshirt_size or "").strip() or None,
        address=(req.address or "").strip() or None,
        position=next_pos,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    _audit_team_edit(
        db, team_id=team.id,
        summary=f"Added member: {member.name} <{member.email or 'no-email'}>",
        reason=req.edit_reason,
        editor_email=_signed_in_email(claims),
    )
    db.commit()
    return member


@app.patch("/api/members/{member_id}", response_model=MemberOut)
def patch_member(
    member_id: int,
    req: MemberPatch,
    db: Session = Depends(get_db),
    claims: dict = Depends(require_auth),
) -> models.Member:
    member = db.query(models.Member).get(member_id)
    if not member:
        raise HTTPException(status_code=404, detail="member not found")

    changes: list[str] = []
    for field in ("name", "email", "location", "tshirt_size", "address"):
        new_val = getattr(req, field)
        if new_val is None:
            continue
        new_val = new_val.strip()
        normalised = new_val if field == "name" else (new_val or None)
        if field == "name" and not normalised:
            raise HTTPException(status_code=400, detail="name cannot be blank")
        old_val = getattr(member, field)
        if normalised != old_val:
            changes.append(f"{field}: {old_val!r} -> {normalised!r}")
            setattr(member, field, normalised)

    if not changes:
        return member

    db.commit()
    db.refresh(member)
    _audit_team_edit(
        db, team_id=member.team_id,
        summary=f"Updated member #{member.id} ({member.name}): " + "; ".join(changes),
        reason=req.edit_reason,
        editor_email=_signed_in_email(claims),
    )
    db.commit()
    return member


def _find_raw_value(raw: dict, *needles: str) -> str | None:
    """Backfill helper — find the first JSON value whose key contains ALL
    given substrings (case-insensitive). Mirrors importer._find_col so the
    same matching logic applies post-hoc to the stored `raw` blob.
    """
    import re as _re
    def _norm(s: str) -> str:
        return _re.sub(r"\s+", " ", str(s or "").strip().lower())
    for k, v in raw.items():
        nk = _norm(k)
        if all(_norm(n) in nk for n in needles):
            if v is None:
                return None
            s = str(v).strip()
            return s if s else None
    return None


def _raw_address_slots(raw: dict) -> dict[int, str | None]:
    """Return mailing address values from a raw row keyed by slot index.

    MS Forms column naming:
      "Enter your mailing address if you opted for US or PH as location"  → slot 0 (mentor)
      "Enter your mailing address if you opted for US or PH as location1" → slot 1 (member 1)
      "Enter your mailing address if you opted for US or PH as location2" → slot 2 (member 2)
      ...
      "Enter your mailing address if you opted for US or PH as location5" → slot 5 (member 5)

    No trailing digit → slot 0 (mentor).  Trailing digit N → slot N (member N).
    """
    import re as _re

    def _norm(s: str) -> str:
        return _re.sub(r"\s+", " ", str(s or "").strip().lower())

    slots: dict[int, str | None] = {}
    for k, v in raw.items():
        nk = _norm(k)
        if ("mailing" in nk and "address" in nk) or "opted for us or ph" in nk:
            m = _re.search(r"(\d+)\s*$", k.strip())
            slot = int(m.group(1)) if m else 0  # no digit = mentor slot 0
            val = str(v).strip() if v is not None else None
            slots[slot] = val if val else None
    return slots


@app.post("/api/admin/backfill-mentor-locations")
def backfill_mentor_locations(
    db: Session = Depends(get_db),
    claims: dict = Depends(require_auth),
) -> dict:
    """One-shot: read each Team.raw and populate mentor_location /
    mentor_tshirt_size / mentor_address / member.address for records
    where those columns are blank.

    Useful after the importer fix lands: older registrations imported
    before these fields were captured still have NULL in the columns,
    but the original Excel row sits in the `raw` JSON blob — so we can
    recover the values without a re-upload (which would wipe organizer
    edits made on the dashboard).
    """
    teams = db.query(models.Team).all()
    locations_set = 0
    tshirts_set = 0
    mentor_addresses_set = 0
    member_addresses_set = 0
    examined = 0
    for t in teams:
        if not isinstance(t.raw, dict) or not t.raw:
            continue
        examined += 1
        if not t.mentor_location:
            loc = _find_raw_value(t.raw, "mentor", "location")
            if loc:
                t.mentor_location = loc
                locations_set += 1
        if not t.mentor_tshirt_size:
            ts = _find_raw_value(t.raw, "mentor", "shirt")
            if ts:
                t.mentor_tshirt_size = ts
                tshirts_set += 1
        # Mailing addresses — MS Forms uses unnamed repeated columns with
        # numeric suffixes (no suffix = slot 0 = mentor; suffix N = member N).
        addr_slots = _raw_address_slots(t.raw)
        if not t.mentor_address:
            addr = addr_slots.get(0)
            if addr:
                t.mentor_address = addr
                mentor_addresses_set += 1
        for m in t.members:
            if m.address:
                continue
            addr = addr_slots.get(m.position)  # slot N = member N (1-indexed)
            if addr:
                m.address = addr
                member_addresses_set += 1
    db.commit()
    return {
        "teams_total": len(teams),
        "teams_with_raw": examined,
        "mentor_locations_set": locations_set,
        "mentor_tshirt_sizes_set": tshirts_set,
        "mentor_addresses_set": mentor_addresses_set,
        "member_addresses_set": member_addresses_set,
        "performed_by": _signed_in_email(claims),
    }


@app.delete("/api/members/{member_id}")
def delete_member(
    member_id: int,
    db: Session = Depends(get_db),
    claims: dict = Depends(require_auth),
) -> dict:
    member = db.query(models.Member).get(member_id)
    if not member:
        raise HTTPException(status_code=404, detail="member not found")
    team_id = member.team_id
    summary = f"Removed member #{member.id} ({member.name} <{member.email or 'no-email'}>)"
    db.delete(member)
    db.commit()
    _audit_team_edit(
        db, team_id=team_id, summary=summary, reason=None,
        editor_email=_signed_in_email(claims),
    )
    db.commit()
    return {"deleted": True, "member_id": member_id}
