from fastapi import Request
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)

# Optional sandbox engine — only created if a sandbox_database_url is set.
# Same schema, separate physical database. Used when the super-admin toggles
# 'Test Mode' on the frontend: every request from that session sends an
# `x-sandbox: true` header and `get_db` routes the session here instead of prod.
sandbox_engine: Engine | None = None
SandboxSessionLocal: sessionmaker | None = None
if settings.sandbox_database_url:
    sandbox_engine = create_engine(
        settings.sandbox_database_url,
        connect_args={"check_same_thread": False} if settings.sandbox_database_url.startswith("sqlite") else {},
    )
    SandboxSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sandbox_engine)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record):
    """Enable Write-Ahead Logging for better concurrency and durability."""
    try:
        if "sqlite" in str(type(dbapi_connection)).lower():
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    except Exception:
        pass


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db(request: Request):
    """Per-request DB session.

    If the request includes `x-sandbox: true` AND a sandbox engine is configured,
    yield a session bound to the sandbox database. Otherwise yield the normal
    production session. Frontend sets the header when Test Mode is on.
    """
    use_sandbox = (
        SandboxSessionLocal is not None
        and request.headers.get("x-sandbox", "").lower() in {"1", "true", "yes"}
    )
    factory = SandboxSessionLocal if use_sandbox else SessionLocal
    db: Session = factory()  # type: ignore[misc]
    try:
        yield db
    finally:
        db.close()


def is_sandbox_request(request: Request) -> bool:
    """True when the incoming request is targeting the sandbox DB."""
    return (
        SandboxSessionLocal is not None
        and request.headers.get("x-sandbox", "").lower() in {"1", "true", "yes"}
    )


def lightweight_migrate(target_engine: Engine | None = None) -> None:
    """SQLite-friendly inline migration: add columns the model expects but the DB lacks.

    Runs against the prod engine by default. Pass `target_engine=sandbox_engine`
    to apply the same migrations to the sandbox database — needed when new
    columns ship between sandbox creations.
    """
    eng = target_engine if target_engine is not None else engine
    insp = inspect(eng)
    if "teams" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("teams")}
    additions: list[str] = []
    if "ai_scores" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN ai_scores JSON")
    if "judge_scores" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN judge_scores JSON")
    if "repo_url" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN repo_url VARCHAR(512)")
    if "has_teams_channel" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN has_teams_channel BOOLEAN DEFAULT 0")
    if "teams_channel_id" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN teams_channel_id VARCHAR(128)")
    if "teams_channel_created_at" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN teams_channel_created_at DATETIME")
    if "presentation_uploaded" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN presentation_uploaded BOOLEAN DEFAULT 0")
    if "repo_ready" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN repo_ready BOOLEAN DEFAULT 0")
    if "repo_check_notes" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN repo_check_notes TEXT")
    if "advanced_to_round" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN advanced_to_round INTEGER DEFAULT 1")
    if "final_position" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN final_position INTEGER")
    if "mentor_location" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN mentor_location VARCHAR(64)")
    if "mentor_tshirt_size" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN mentor_tshirt_size VARCHAR(16)")
    if "mentor_address" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN mentor_address TEXT")
    # Floor-walk seat capture. Postgres doesn't have a DATETIME type (it has
    # TIMESTAMP); SQLite accepts either. Branch on dialect so the ALTER runs
    # cleanly on both. Older 'DATETIME' migration lines above haven't hit this
    # because those columns were already present when Postgres first ran
    # Base.metadata.create_all -- the IF NOT EXISTS check skipped them.
    ts_type = "TIMESTAMP" if eng.dialect.name == "postgresql" else "DATETIME"
    if "seat_floor" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN seat_floor VARCHAR(16)")
    if "seat_desk" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN seat_desk VARCHAR(64)")
    if "seat_landmark" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN seat_landmark TEXT")
    if "seat_updated_at" not in existing:
        additions.append(f"ALTER TABLE teams ADD COLUMN seat_updated_at {ts_type}")
    if "seat_updated_by" not in existing:
        additions.append("ALTER TABLE teams ADD COLUMN seat_updated_by VARCHAR(255)")

    # Drop the (judge_id, team_id) unique constraint on judge_visits if it
    # exists -- earlier model had it for "one visit per pair" semantics, then
    # the organizer asked for an audit-log shape (multiple visits per pair
    # across Day 1 / Day 2). Postgres-only: SQLite can't DROP CONSTRAINT
    # in-place. Dev SQLite users delete + recreate the file if affected.
    if eng.dialect.name == "postgresql" and "judge_visits" in insp.get_table_names():
        additions.append("ALTER TABLE judge_visits DROP CONSTRAINT IF EXISTS uq_judge_team_visit")
        # Make judge_id nullable: organizers now walk with groups of judges
        # as a unit, so individual judge attribution per visit is optional.
        # Each visit is still owned by the organizer who logged it.
        additions.append("ALTER TABLE judge_visits ALTER COLUMN judge_id DROP NOT NULL")

    # Members table — same idempotent shape.
    if "members" in insp.get_table_names():
        member_existing = {c["name"] for c in insp.get_columns("members")}
        if "address" not in member_existing:
            additions.append("ALTER TABLE members ADD COLUMN address TEXT")

    # Swag pickups — added late, may not be present in older DBs.
    if "swag_pickups" in insp.get_table_names():
        swag_existing = {c["name"] for c in insp.get_columns("swag_pickups")}
        if "picked_up_by_name" not in swag_existing:
            additions.append("ALTER TABLE swag_pickups ADD COLUMN picked_up_by_name VARCHAR(255)")
        if "picked_up_by_email" not in swag_existing:
            additions.append("ALTER TABLE swag_pickups ADD COLUMN picked_up_by_email VARCHAR(255)")
    # Run each ALTER in its own transaction so one failure doesn't roll back
    # the rest. We log+continue on per-statement errors instead of crashing
    # the FastAPI app at startup -- previously a single permission error
    # ('must be owner of table teams' when the DB user lacks DDL grants)
    # took the entire service down with 502s. The new behaviour: the column
    # is missing in the DB but the app still serves; endpoints that read the
    # missing column will 500 individually, but everything else keeps working
    # and an organizer can fix the DB out-of-band without an outage.
    import logging
    log = logging.getLogger(__name__)
    for sql in additions:
        try:
            with eng.begin() as conn:
                conn.execute(text(sql))
        except Exception as e:
            log.error("lightweight_migrate: skipping failed ALTER -- %s | sql=%s", e, sql)

    # ---- Cascade FK upgrade (Postgres only) ----
    # Drop and re-add the team-referencing foreign keys with ON DELETE
    # semantics so re-uploads (which wipe the teams table) don't fail
    # with FK violations from existing members / judge scores / comm logs.
    #   members.team_id           -> CASCADE  (orphaned members are useless)
    #   judge_score_records.team_id -> CASCADE  (scores belong to a team)
    #   judge_score_records.judge_id -> CASCADE
    #   comm_log.team_id          -> SET NULL (preserve audit trail, null the team ref)
    # The constraint names below are Postgres's default: <table>_<column>_fkey.
    if eng.dialect.name == "postgresql":
        cascade_migrations = [
            # members.team_id -> teams.id ON DELETE CASCADE
            "ALTER TABLE members DROP CONSTRAINT IF EXISTS members_team_id_fkey",
            "ALTER TABLE members ADD CONSTRAINT members_team_id_fkey "
            "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE",
            # judge_score_records.team_id -> teams.id ON DELETE CASCADE
            "ALTER TABLE judge_score_records DROP CONSTRAINT IF EXISTS judge_score_records_team_id_fkey",
            "ALTER TABLE judge_score_records ADD CONSTRAINT judge_score_records_team_id_fkey "
            "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE",
            # judge_score_records.judge_id -> judges.id ON DELETE CASCADE
            "ALTER TABLE judge_score_records DROP CONSTRAINT IF EXISTS judge_score_records_judge_id_fkey",
            "ALTER TABLE judge_score_records ADD CONSTRAINT judge_score_records_judge_id_fkey "
            "FOREIGN KEY (judge_id) REFERENCES judges(id) ON DELETE CASCADE",
            # comm_log.team_id -> teams.id ON DELETE SET NULL
            "ALTER TABLE comm_log DROP CONSTRAINT IF EXISTS comm_log_team_id_fkey",
            "ALTER TABLE comm_log ADD CONSTRAINT comm_log_team_id_fkey "
            "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL",
        ]
        with eng.begin() as conn:
            for sql in cascade_migrations:
                try:
                    conn.execute(text(sql))
                except Exception:  # pragma: no cover — best-effort migration
                    # If the table doesn't exist yet (fresh DB) or the constraint
                    # is already correct, skip silently. SQLAlchemy create_all will
                    # set the right thing for fresh tables based on models.py.
                    pass
