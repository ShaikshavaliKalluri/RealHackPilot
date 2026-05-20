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
    if additions:
        with engine.begin() as conn:
            for sql in additions:
                conn.execute(text(sql))
