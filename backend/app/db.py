from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)


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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def lightweight_migrate() -> None:
    """SQLite-friendly inline migration: add columns the model expects but the DB lacks."""
    insp = inspect(engine)
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

    # Members table — same idempotent shape.
    if "members" in insp.get_table_names():
        member_existing = {c["name"] for c in insp.get_columns("members")}
        if "address" not in member_existing:
            additions.append("ALTER TABLE members ADD COLUMN address TEXT")
    if additions:
        with engine.begin() as conn:
            for sql in additions:
                conn.execute(text(sql))

    # ---- Cascade FK upgrade (Postgres only) ----
    # Drop and re-add the team-referencing foreign keys with ON DELETE
    # semantics so re-uploads (which wipe the teams table) don't fail
    # with FK violations from existing members / judge scores / comm logs.
    #   members.team_id           -> CASCADE  (orphaned members are useless)
    #   judge_score_records.team_id -> CASCADE  (scores belong to a team)
    #   judge_score_records.judge_id -> CASCADE
    #   comm_log.team_id          -> SET NULL (preserve audit trail, null the team ref)
    # The constraint names below are Postgres's default: <table>_<column>_fkey.
    if engine.dialect.name == "postgresql":
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
        with engine.begin() as conn:
            for sql in cascade_migrations:
                try:
                    conn.execute(text(sql))
                except Exception:  # pragma: no cover — best-effort migration
                    # If the table doesn't exist yet (fresh DB) or the constraint
                    # is already correct, skip silently. SQLAlchemy create_all will
                    # set the right thing for fresh tables based on models.py.
                    pass
