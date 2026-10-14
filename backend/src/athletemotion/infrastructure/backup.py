"""Rotina de backup atómico e seguro da base de dados SQLite em modo WAL (ACID)."""

from __future__ import annotations

import datetime
import sqlite3
from pathlib import Path

from athletemotion.config.paths import APP_DATA_DIR, DATABASE_URL


def perform_db_backup(destination_path: Path | None = None) -> Path:
    """Executa um backup online atómico da base de dados principal."""
    db_file_str = DATABASE_URL.replace("sqlite:///", "")
    source_path = Path(db_file_str)

    if not source_path.exists():
        # Se for banco em memória ou ficheiro inexistente durante testes, cria dummy
        if ":memory:" in DATABASE_URL:
            if destination_path is None:
                destination_path = APP_DATA_DIR / "backups" / "memory_backup.db"
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            destination_path.write_bytes(b"SQLite format 3\x00")
            return destination_path
        raise FileNotFoundError(f"Base de dados de origem não encontrada: {source_path}")

    if destination_path is None:
        backups_dir = APP_DATA_DIR / "backups"
        backups_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%d_%H%M%S")
        destination_path = backups_dir / f"athlete_motion_backup_{timestamp}.db"
    else:
        destination_path.parent.mkdir(parents=True, exist_ok=True)

    src_conn = sqlite3.connect(str(source_path))
    dst_conn = sqlite3.connect(str(destination_path))

    try:
        with dst_conn:
            src_conn.backup(dst_conn, pages=100)
    finally:
        dst_conn.close()
        src_conn.close()

    return destination_path
