"""Restore a JSON snapshot written by backup_db.py.

WIPES the existing rows in the captured tables, then re-inserts every row
in dependency order. Schema (CREATE TABLE etc.) is expected to already
exist — this restore is row-data only.

After restoring you SHOULD restart the backend so it re-runs
lightweight_migrate() and any column-default initialisers.

Usage:
    sudo systemctl stop realhack-pilot
    sudo -u realhack .venv/bin/python restore_db.py \
        --file /opt/realhack-pilot/backups/realhack_<TS>_<reason>.json
    sudo systemctl start realhack-pilot

Safety: pass --dry-run to see counts that would be wiped + inserted
without making any changes.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app import models  # noqa: E402

# Restore inserts in this order (parents before children).
# Wipe goes in reverse (children before parents) so FK constraints don't fight.
RESTORE_ORDER = ("teams", "members", "judges", "judge_score_records", "comm_log")

DATETIME_FIELDS = {
    "teams": {"submitted_at", "teams_channel_created_at"},
    "members": set(),
    "judges": {"created_at"},
    "judge_score_records": {"submitted_at"},
    "comm_log": {"sent_at"},
}


def _coerce(row: dict, dt_fields: set[str]) -> dict:
    """Convert ISO-format strings back to datetime objects."""
    out = dict(row)
    for k in dt_fields:
        v = out.get(k)
        if isinstance(v, str):
            try:
                out[k] = datetime.fromisoformat(v)
            except ValueError:
                out[k] = None
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore a JSON snapshot of app tables")
    parser.add_argument("--file", required=True, help="Path to a snapshot .json file")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would change; don't write to the DB.")
    args = parser.parse_args()

    src = Path(args.file)
    if not src.exists():
        print(f"ERROR: file not found: {src}")
        return 2

    with src.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    if payload.get("schema_version") != 1:
        print(f"ERROR: unsupported schema_version: {payload.get('schema_version')}")
        return 3

    print(f"Snapshot captured: {payload.get('captured_at_utc')}  reason={payload.get('reason')}")
    print()
    print("Row counts in snapshot:")
    for table in RESTORE_ORDER:
        rows = payload["tables"].get(table, [])
        print(f"  {table:30s} {len(rows):5d}")

    model_for_table = {
        "teams": models.Team,
        "members": models.Member,
        "judges": models.Judge,
        "judge_score_records": models.JudgeScore,
        "comm_log": models.CommLog,
    }

    if args.dry_run:
        print()
        print("DRY RUN — no changes made. Re-run without --dry-run to apply.")
        return 0

    print()
    print("Wiping current rows...")
    # DELETE in reverse order so FK refs don't break.
    with SessionLocal() as s:
        for table in reversed(RESTORE_ORDER):
            s.execute(text(f"DELETE FROM {table}"))
        s.commit()
        print("  done — all target tables empty.")

        print("Inserting from snapshot...")
        for table in RESTORE_ORDER:
            cls = model_for_table[table]
            dt_fields = DATETIME_FIELDS.get(table, set())
            rows = payload["tables"].get(table, [])
            for r in rows:
                obj = cls(**_coerce(r, dt_fields))
                s.add(obj)
            s.flush()
            print(f"  {table:30s} {len(rows):5d} rows inserted")
        s.commit()

    print()
    print("Restore complete. Now restart the backend so it re-initialises:")
    print("  sudo systemctl start realhack-pilot")
    return 0


if __name__ == "__main__":
    sys.exit(main())
