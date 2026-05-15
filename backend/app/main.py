from __future__ import annotations

import os
import shutil
import tempfile
from collections import Counter

import csv
import io

from fastapi import FastAPI, File, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .config import settings
from .db import Base, engine, get_db, lightweight_migrate
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
from fastapi.responses import FileResponse
from .schemas import (
    TeamOut, UploadResult, DashboardStats, AIScreenResult,
    EmailTemplateOut, EmailRenderRequest, RenderedEmail,
    JudgeAIRequest, JudgeHumanRequest,
    JudgeOut, JudgeCreate, JudgeScoreSubmit, JudgeScoreOut,
    LeaderboardOut, LeaderboardRow, JUDGE_RUBRIC_AXES,
    CommLogOut, TeamChannelCreateRequest, TeamMessageRequest, BroadcastRequest,
    CommLogCreateRequest, RepoCheckOut, ReadinessFlagsRequest,
)


app = FastAPI(title="RealHack Pilot API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    Base.metadata.create_all(bind=engine)
    lightweight_migrate()
    backup_service.start_scheduler()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "env": settings.app_env}


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
    for t in teams:
        for m in t.members:
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
        db.query(models.Member).delete()
        db.query(models.Team).delete()
        db.flush()

    teams = dicts_to_models(team_dicts)
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


@app.post("/api/ai-screen", response_model=AIScreenResult)
def ai_screen(force: bool = False, db: Session = Depends(get_db)) -> AIScreenResult:
    summary = ai_score_all(db, force=force)
    db.commit()
    return AIScreenResult(**summary)


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
