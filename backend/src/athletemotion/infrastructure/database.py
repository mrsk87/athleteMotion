"""Camada de persistência relacional com conformidade estrita aos princípios ACID.

Utiliza SQLite com Write-Ahead Logging (WAL), integridade referencial forçada e
migrações versionadas pelo Alembic para garantir durabilidade, atomicidade e isolamento.
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from athletemotion.config.paths import DATABASE_URL, ensure_app_directories
from athletemotion.infrastructure.models import (
    AthleteModel,
    Base,
    BikeModel,
    CameraProfileModel,
    FitSessionModel,
    PostureSnapshotModel,
)

logger = logging.getLogger(__name__)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
    echo=False,
)


# ==============================================================================
# CONFIGURAÇÃO DE INTEGRIDADE TRANSACIONAL ACID PARA SQLITE
# ==============================================================================
@event.listens_for(engine, "connect")
def configure_sqlite_pragmas(dbapi_connection, connection_record):
    """Ativa pragmas essenciais para integridade transacional ACID no SQLite."""
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        # 1. CONSISTÊNCIA: Forçar integridade referencial de chaves estrangeiras
        cursor.execute("PRAGMA foreign_keys = ON;")
        # 2. ISOLAMENTO: Ativar WAL para permitir leitores concorrentes sem bloquear escritores
        cursor.execute("PRAGMA journal_mode = WAL;")
        # 3. DURABILIDADE CONTROLADA: NORMAL para snapshots contínuos com bom throughput
        cursor.execute("PRAGMA synchronous = NORMAL;")
        # 4. TOLERÂNCIA A CONCORRÊNCIA: timeout de bloqueio de 30 segundos
        cursor.execute("PRAGMA busy_timeout = 30000;")
        cursor.close()


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine,
)


def force_db_sync() -> None:
    """Força persistência atómica integral e sincronização do WAL para o ficheiro principal (fsync)."""
    with engine.begin() as conn:
        conn.exec_driver_sql("PRAGMA synchronous = FULL;")
        conn.exec_driver_sql("PRAGMA wal_checkpoint(PASSIVE);")
        conn.exec_driver_sql("PRAGMA synchronous = NORMAL;")


def optimize_database() -> None:
    """Executa otimização e recolha de estatísticas no shutdown da aplicação."""
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql("PRAGMA optimize;")
        logger.info("Otimização de base de dados SQLite executada com sucesso.")
    except (sqlite3.Error, OSError) as exc:
        logger.warning("Falha na otimização de fecho da base de dados: %s", exc)


def run_alembic_migrations(target_engine=None) -> None:
    """Aplica migrações pendentes do Alembic de forma programática até à revisão 'head'."""
    from alembic import command
    from alembic.config import Config

    active_engine = target_engine or engine
    db_url_str = str(active_engine.url)

    if ":memory:" in db_url_str or "%3Amemory%3A" in db_url_str:
        Base.metadata.create_all(bind=active_engine)
        return

    # Localizar alembic.ini a partir da raiz do backend
    backend_root = Path(__file__).resolve().parents[3]
    alembic_ini_path = backend_root / "alembic.ini"

    if alembic_ini_path.exists():
        alembic_cfg = Config(str(alembic_ini_path))
        alembic_cfg.set_main_option("script_location", str(backend_root / "migrations"))

        with active_engine.connect() as conn:
            alembic_cfg.attributes["connection"] = conn
            tables = set(conn.dialect.get_table_names(conn))
            if "bikes" in tables:
                has_version_table = "alembic_version" in tables
                if not has_version_table:
                    cols = {
                        row[1]
                        for row in conn.exec_driver_sql("PRAGMA table_info(bikes)").fetchall()
                    }
                    if "handlebar_reach_mm" in cols:
                        command.stamp(alembic_cfg, "0002_handlebar_and_cleats")
                    else:
                        command.stamp(alembic_cfg, "0001_baseline")

            command.upgrade(alembic_cfg, "head")
        logger.info("Migrações do Alembic aplicadas com sucesso (head).")
    else:
        # Fallback de emergência (por ex. em ambientes de teste sem alembic.ini)
        Base.metadata.create_all(bind=active_engine)


def init_db() -> None:
    """Inicializa as tabelas da base de dados e aplica migrações automáticas."""
    ensure_app_directories()
    run_alembic_migrations(engine)


def get_db():
    """Dependência do FastAPI para disponibilização de sessão de base de dados."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


__all__ = [
    "AthleteModel",
    "Base",
    "BikeModel",
    "CameraProfileModel",
    "FitSessionModel",
    "PostureSnapshotModel",
    "SessionLocal",
    "engine",
    "force_db_sync",
    "get_db",
    "init_db",
    "optimize_database",
    "run_alembic_migrations",
]
