"""One-shot Postgres backup using the existing SQLAlchemy session.

Doesn't need pg_dump installed — uses psycopg2 (already in the venv) to
read every row of every app table and write them to a single JSON file
that restore_db.py can replay.

Output: /opt/realhack-pilot/backups/realhack_<UTC-timestamp>_<reason>.json
  (path is configurable via --out / BACKUPS_DIR env var)

Usage:
    sudo -u realhack .venv/bin/python backup_db.py --reason pre_reupload
    sudo -u realhack .venv/bin/python backup_db.py --reason scheduled --out /tmp/snap.json

Tables captured (in dependency order so restore can replay without FK breaks):
    teams, members, judges, judge_score_records, comm_log

Caveats: doesn't capture sequences (auto-increment counters), indexes, or
DB-level constraints — only the row data. For an event-prep snapshot this
is enough because:
  - sequences will resume from MAX(id)+1 in Postgres after a wipe+insert
  - the schema is re-created by lightweight_migrate() at backend startup
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Make `app` importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import inspect  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app import models  # noqa: E402

# Order matters on restore: parents before children.
DUMP_TABLES = ("teams", "members", "judges", "judge_score_records", "comm_log")


def _row_to_dict(table_name: str, row) -> dict:
    out: dict = {}
    for col in inspect(engine).get_columns(table_name):
        name = col["name"]
        v = getattr(row, name, None)
        # JSON-serialise datetimes
        if isinstance(v, datetime):
            v = v.isoformat()
        out[name] = v
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Backup all app tables to JSON")
    parser.add_argument("--reason", default="manual",
                        help="Tag added to filename. Examples: pre_reupload, daily, before_x")
    parser.add_argument("--out", default=None,
                        help="Override output path. Default: $BACKUPS_DIR or /opt/realhack-pilot/backups")
    args = parser.parse_args()

    backups_dir = Path(args.out).parent if args.out else Path(
        os.environ.get("BACKUPS_DIR", "/opt/realhack-pilot/backups")
    )
    backups_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_reason = "".join(c if c.isalnum() or c in ("_", "-") else "_" for c in args.reason)
    out_path = Path(args.out) if args.out else (backups_dir / f"realhack_{ts}_{safe_reason}.json")

    # Map table name -> SQLAlchemy ORM class (only the ones we care about)
    model_for_table = {
        "teams": models.Team,
        "members": models.Member,
        "judges": models.Judge,
        "judge_score_records": models.JudgeScore,
        "comm_log": models.CommLog,
    }

    payload: dict = {
        "schema_version": 1,
        "captured_at_utc": datetime.utcnow().isoformat(),
        "reason": args.reason,
        "tables": {},
        "counts": {},
    }

    print(f"Dumping to {out_path}")
    with SessionLocal() as s:
        for table in DUMP_TABLES:
            cls = model_for_table[table]
            rows = s.query(cls).all()
            payload["tables"][table] = [_row_to_dict(table, r) for r in rows]
            payload["counts"][table] = len(rows)
            print(f"  {table:30s} {len(rows):5d} rows")

    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=str)

    size_kb = out_path.stat().st_size / 1024
    print(f"Done — {size_kb:,.1f} KB → {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
