"""SQLite online backup, rotation, and restore.

Uses sqlite3's online backup API — safe even while the app is writing.
Backups are written to ./backups/ with timestamped filenames.

Schedule: background thread does a backup every 5 minutes by default.
Retention: keep the last MAX_BACKUPS files.

Restore: copies a chosen backup over the active DB, disposes the engine
pool so the next request reconnects to the restored data.
"""
from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path

from .config import settings
from .db import engine, SessionLocal

logger = logging.getLogger("backup")

BACKUP_INTERVAL_SECONDS = 5 * 60   # 5 minutes
MAX_BACKUPS = 50

_backup_lock = threading.Lock()
_last_backup_at: datetime | None = None
_last_backup_path: Path | None = None
_last_backup_reason: str | None = None


def _db_path() -> Path | None:
    url = settings.database_url
    if not url.startswith("sqlite:///"):
        return None
    # sqlite:///./realhack_pilot.db  → ./realhack_pilot.db
    raw = url.removeprefix("sqlite:///")
    return Path(raw).resolve()


def _backups_dir() -> Path:
    d = Path("./backups").resolve()
    d.mkdir(parents=True, exist_ok=True)
    return d


def do_backup(reason: str = "scheduled") -> dict:
    """Perform an online backup of the SQLite DB. Returns metadata about the backup."""
    global _last_backup_at, _last_backup_path, _last_backup_reason

    src_path = _db_path()
    if src_path is None or not src_path.exists():
        return {"ok": False, "error": "DB file not found (non-SQLite or missing)"}

    with _backup_lock:
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        dst_path = _backups_dir() / f"realhack_pilot_{ts}_{reason}.db"

        try:
            src = sqlite3.connect(str(src_path))
            dst = sqlite3.connect(str(dst_path))
            try:
                src.backup(dst)
            finally:
                dst.close()
                src.close()
        except Exception as e:
            logger.warning("Backup failed: %s", e)
            return {"ok": False, "error": str(e)}

        _last_backup_at = datetime.utcnow()
        _last_backup_path = dst_path
        _last_backup_reason = reason

        _rotate()

        return {
            "ok": True,
            "path": str(dst_path),
            "filename": dst_path.name,
            "size_bytes": dst_path.stat().st_size,
            "at": _last_backup_at.isoformat(),
            "reason": reason,
        }


def _rotate() -> int:
    """Keep the most recent MAX_BACKUPS, delete older."""
    backups = sorted(_backups_dir().glob("realhack_pilot_*.db"), reverse=True)
    deleted = 0
    for old in backups[MAX_BACKUPS:]:
        try:
            old.unlink()
            deleted += 1
        except OSError:
            pass
    return deleted


def list_backups() -> list[dict]:
    backups = sorted(_backups_dir().glob("realhack_pilot_*.db"), reverse=True)
    out: list[dict] = []
    for b in backups:
        try:
            st = b.stat()
            out.append({
                "filename": b.name,
                "size_bytes": st.st_size,
                "at": datetime.utcfromtimestamp(st.st_mtime).isoformat(),
                "reason": _parse_reason(b.name),
            })
        except OSError:
            continue
    return out


def _parse_reason(name: str) -> str:
    # realhack_pilot_20260516_023000_scheduled.db → "scheduled"
    parts = name.removesuffix(".db").split("_")
    if len(parts) >= 5:
        return "_".join(parts[4:])
    return "unknown"


def get_status() -> dict:
    is_sqlite = settings.database_url.startswith("sqlite")
    src_path = _db_path()
    db_size = src_path.stat().st_size if (src_path and src_path.exists()) else 0
    backups = list_backups() if is_sqlite else []
    counts = _row_counts()
    return {
        "db_engine": "sqlite" if is_sqlite else "postgresql",
        "db_url_redacted": _redact_url(settings.database_url),
        "db_path": str(src_path) if (src_path and is_sqlite) else None,
        "db_size_bytes": db_size,
        "last_backup_at": _last_backup_at.isoformat() if _last_backup_at else None,
        "last_backup_reason": _last_backup_reason,
        "last_backup_path": str(_last_backup_path) if _last_backup_path else None,
        "backup_count": len(backups),
        "next_backup_in_seconds": BACKUP_INTERVAL_SECONDS if is_sqlite else None,
        "auto_backup_active": is_sqlite,
        "backup_note": (
            "SQLite file-level snapshots every 5 minutes (50 retained)."
            if is_sqlite else
            "PostgreSQL — file-level snapshots disabled. Use pg_dump or the hosting provider's backups for durability."
        ),
        "row_counts": counts,
    }


def _redact_url(url: str) -> str:
    """Hide the password in a SQLAlchemy URL for display."""
    try:
        if "://" not in url:
            return url
        head, tail = url.split("://", 1)
        if "@" in tail and ":" in tail.split("@", 1)[0]:
            creds, rest = tail.split("@", 1)
            user, _ = creds.split(":", 1)
            return f"{head}://{user}:***@{rest}"
        return url
    except Exception:
        return "<redacted>"


def _row_counts() -> dict[str, int]:
    """Quick liveness check — counts for the tables that matter."""
    from .models import Team, Judge, JudgeScore, CommLog
    out: dict[str, int] = {}
    try:
        with SessionLocal() as s:
            out["teams"] = s.query(Team).count()
            out["judges"] = s.query(Judge).count()
            out["judge_scores"] = s.query(JudgeScore).count()
            out["comm_log"] = s.query(CommLog).count()
    except Exception as e:
        out["error"] = str(e)
    return out


def restore(filename: str, make_pre_restore_backup: bool = True) -> dict:
    """Restore the active DB from a backup file. Returns the result + a freshly-made pre-restore backup path."""
    src_path = _db_path()
    if src_path is None:
        return {"ok": False, "error": "Non-SQLite database — restore not supported here"}

    candidate = _backups_dir() / filename
    if not candidate.exists() or not candidate.is_file():
        return {"ok": False, "error": f"Backup file not found: {filename}"}

    # Belt-and-suspenders: snapshot the current state before overwriting
    pre_restore_path = None
    if make_pre_restore_backup:
        pre = do_backup(reason="pre_restore")
        if pre.get("ok"):
            pre_restore_path = pre["path"]

    with _backup_lock:
        # Close all pool connections so no one holds the file open
        engine.dispose()
        try:
            shutil.copyfile(candidate, src_path)
            # WAL files for the new DB will be regenerated on next open; clear stale ones
            for sidecar in (src_path.with_suffix(src_path.suffix + "-wal"), src_path.with_suffix(src_path.suffix + "-shm")):
                if sidecar.exists():
                    try:
                        sidecar.unlink()
                    except OSError:
                        pass
        except Exception as e:
            logger.exception("Restore failed: %s", e)
            return {"ok": False, "error": str(e), "pre_restore_backup": pre_restore_path}

    return {
        "ok": True,
        "restored_from": filename,
        "pre_restore_backup": pre_restore_path,
        "at": datetime.utcnow().isoformat(),
    }


# ===== Background scheduler =====

_thread_started = False


def start_scheduler() -> None:
    global _thread_started
    if _thread_started:
        return
    # Skip if not running on SQLite — Postgres has its own backup story (pg_dump / managed service)
    if not settings.database_url.startswith("sqlite"):
        logger.info("Backup scheduler skipped — DB is not SQLite (%s)", _redact_url(settings.database_url))
        return
    _thread_started = True
    t = threading.Thread(target=_loop, name="backup-scheduler", daemon=True)
    t.start()


def _loop() -> None:
    # Do an initial backup shortly after startup so we always have at least one
    time.sleep(10)
    try:
        do_backup(reason="startup")
    except Exception as e:
        logger.warning("Startup backup failed: %s", e)

    while True:
        time.sleep(BACKUP_INTERVAL_SECONDS)
        try:
            do_backup(reason="scheduled")
        except Exception as e:
            logger.warning("Scheduled backup failed: %s", e)
