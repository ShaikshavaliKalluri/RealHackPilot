"""One-shot migration: copy all data from SQLite into Postgres.

Run from backend/ with the venv active:

    .\.venv\Scripts\python.exe migrate_sqlite_to_postgres.py

Reads from:   sqlite:///./realhack_pilot.db
Writes to:    POSTGRES_URL env var (or default below)

Both schemas are created fresh from the same SQLAlchemy models — the row data
is then copied table-by-table, preserving primary keys and relationships.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

# Make sure we can import the app package
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db import Base  # noqa: E402
from app import models  # noqa: E402  (imports register all tables on Base)


SQLITE_URL = "sqlite:///./realhack_pilot.db"
PG_URL_DEFAULT = "postgresql+psycopg2://realhack:realhack_dev@localhost:5432/realhack_pilot"


# Order matters: parents first (referenced) → children (referencing FKs).
TABLES_IN_ORDER: list[type] = [
    models.Team,
    models.Member,
    models.Judge,
    models.JudgeScore,
    models.CommLog,
]


def main() -> int:
    pg_url = os.environ.get("POSTGRES_URL", PG_URL_DEFAULT)
    print(f"SOURCE: {SQLITE_URL}")
    print(f"TARGET: {pg_url}")
    print()

    src_engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    dst_engine = create_engine(pg_url)

    print("Creating target schema (Postgres) …")
    Base.metadata.create_all(bind=dst_engine)

    Src = sessionmaker(bind=src_engine)
    Dst = sessionmaker(bind=dst_engine)

    src = Src()
    dst = Dst()

    counts: dict[str, int] = {}
    try:
        # Optional: warn if target already has rows
        for cls in TABLES_IN_ORDER:
            existing = dst.execute(select(cls).limit(1)).first()
            if existing:
                print(f"  [WARN]target table {cls.__tablename__} already has data — aborting.")
                print("    Drop the Postgres database or use a fresh container to re-run.")
                return 2

        for cls in TABLES_IN_ORDER:
            rows = src.execute(select(cls)).scalars().all()
            for r in rows:
                # Detach from src session, give to dst session
                src.expunge(r)
                # __dict__ contains mapped fields + _sa_instance_state — exclude the state key
                payload = {k: v for k, v in r.__dict__.items() if not k.startswith("_sa_")}
                dst.add(cls(**payload))
            dst.flush()
            counts[cls.__tablename__] = len(rows)
            print(f"  [OK]{cls.__tablename__}: {len(rows)} rows copied")

        # Reset sequences for tables with auto-incrementing IDs (Postgres needs this)
        from sqlalchemy import text
        with dst_engine.begin() as conn:
            for cls in TABLES_IN_ORDER:
                tbl = cls.__tablename__
                # Find max(id) and set the sequence accordingly
                conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{tbl}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {tbl}), 1), true)"
                ))
        print("\n  [OK]sequences advanced past existing IDs")

        dst.commit()
    except Exception:
        dst.rollback()
        raise
    finally:
        src.close()
        dst.close()

    print()
    print(f"Migration finished at {datetime.utcnow().isoformat()}")
    print("Summary:", counts)
    print()
    print("Next steps:")
    print("  1. Update backend/.env →  DATABASE_URL=" + pg_url)
    print("  2. Restart the backend (uvicorn)")
    print("  3. Verify dashboard counts match")
    return 0


if __name__ == "__main__":
    sys.exit(main())
