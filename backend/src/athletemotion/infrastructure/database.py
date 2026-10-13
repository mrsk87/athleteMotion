"""Camada de persistência relacional com conformidade estrita aos princípios ACID.

Utiliza SQLite com Write-Ahead Logging (WAL) e integridade referencial ativa
para garantir durabilidade, atomicidade e isolamento de sessões de treino.
"""
from __future__ import annotations

import datetime
import sqlite3
import uuid
from pathlib import Path

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from athletemotion.config.paths import DATABASE_URL, ensure_app_directories

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
    echo=False,
)


# ==============================================================================
# CONFIGURAÇÃO OBRIGATÓRIA DE ACID PARA SQLITE
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
        # 3. DURABILIDADE: Garantir flush do diário transacional para disco
        cursor.execute("PRAGMA synchronous = NORMAL;")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class AthleteModel(Base):
    """Registo do atleta e medidas corporais antropométricas."""
    __tablename__ = "athletes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(120), nullable=False)
    email = Column(String(120), nullable=True)
    height_cm = Column(Float, nullable=False)
    inseam_cm = Column(Float, nullable=False)  # Cavalo / entre-perna
    shoulder_width_cm = Column(Float, nullable=True)
    torso_length_cm = Column(Float, nullable=True)
    arm_length_cm = Column(Float, nullable=True)
    flexibility = Column(String(20), default="medium", nullable=False)
    riding_style = Column(String(20), default="road", nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)

    bikes = relationship("BikeModel", back_populates="athlete", cascade="all, delete-orphan")
    sessions = relationship("FitSessionModel", back_populates="athlete", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("height_cm > 50.0 AND height_cm < 250.0", name="check_valid_height"),
        CheckConstraint("inseam_cm > 30.0 AND inseam_cm < height_cm", name="check_valid_inseam"),
    )


class BikeModel(Base):
    """Registo de medidas e componentes da bicicleta do atleta."""
    __tablename__ = "bikes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    athlete_id = Column(String(36), ForeignKey("athletes.id", ondelete="CASCADE"), nullable=False)
    bike_type = Column(String(20), default="road", nullable=False)
    brand_model = Column(String(100), default="Minha Bicicleta", nullable=False)
    # Tamanho do quadro = tubo do selim (C-T). O tubo superior efetivo (ETT) é outra medida: é ele
    # que define o comprimento do cockpit sentido pelo atleta (ETT + avanço + reach do guiador).
    frame_size_cm = Column(Float, nullable=True)
    top_tube_mm = Column(Float, nullable=True)
    handlebar_width_mm = Column(Float, nullable=True)
    handlebar_reach_mm = Column(Float, nullable=True)  # Reach do guiador (curva)
    handlebar_drop_mm = Column(Float, nullable=True)  # Drop do guiador (curva)
    stem_length_mm = Column(Float, nullable=True)
    crank_length_mm = Column(Float, nullable=True)
    current_saddle_height_cm = Column(Float, nullable=True)
    # Posição opcional dos travessões/cleats na sapatilha (ex: rearward, neutral, forward)
    cleat_position = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)

    athlete = relationship("AthleteModel", back_populates="bikes")
    sessions = relationship("FitSessionModel", back_populates="bike", cascade="all, delete-orphan")


class FitSessionModel(Base):
    """Sessão transacional de BikeFit contendo objetivos, métricas e diagnóstico."""
    __tablename__ = "fit_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    athlete_id = Column(String(36), ForeignKey("athletes.id", ondelete="CASCADE"), nullable=False)
    bike_id = Column(String(36), ForeignKey("bikes.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), default="IN_PROGRESS", nullable=False)  # IN_PROGRESS, COMPLETED, CANCELLED

    # Valores teóricos calculados a partir dos dados do atleta
    theoretical_saddle_height_cm = Column(Float, nullable=True)
    target_knee_min = Column(Float, default=145.0, nullable=False)
    target_knee_max = Column(Float, default=155.0, nullable=False)
    target_back_min = Column(Float, default=40.0, nullable=False)
    target_back_max = Column(Float, default=50.0, nullable=False)

    # Médias gravadas ao vivo pela câmara
    measured_avg_knee_angle = Column(Float, nullable=True)
    measured_avg_back_angle = Column(Float, nullable=True)
    measured_avg_arm_angle = Column(Float, nullable=True)
    measured_avg_ankle_angle = Column(Float, nullable=True)

    summary_json = Column(Text, nullable=True)
    started_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)
    completed_at = Column(DateTime, nullable=True)

    athlete = relationship("AthleteModel", back_populates="sessions")
    bike = relationship("BikeModel", back_populates="sessions")
    snapshots = relationship("PostureSnapshotModel", back_populates="session", cascade="all, delete-orphan")


class PostureSnapshotModel(Base):
    """Amostra instantânea de ângulos capturada durante a análise em tempo real."""
    __tablename__ = "posture_snapshots"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("fit_sessions.id", ondelete="CASCADE"), nullable=False)
    frame_index = Column(Integer, default=0, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)

    knee_angle = Column(Float, nullable=True)
    back_angle = Column(Float, nullable=True)
    arm_angle = Column(Float, nullable=True)
    ankle_angle = Column(Float, nullable=True)
    is_compliant = Column(Boolean, default=False, nullable=False)
    raw_landmarks_json = Column(Text, nullable=True)

    session = relationship("FitSessionModel", back_populates="snapshots")


# Colunas acrescentadas depois de a base de dados já existir. `create_all` cria tabelas em falta,
# mas nunca altera uma tabela existente: sem esta lista, quem já tem o ficheiro SQLite veria a
# aplicação falhar ao gravar/carregar o guiador do atleta.
_ADDED_COLUMNS = {
    "bikes": [
        ("handlebar_reach_mm", "FLOAT"),
        ("handlebar_drop_mm", "FLOAT"),
        ("top_tube_mm", "FLOAT"),
        ("cleat_position", "VARCHAR(30)"),
    ],
}


def _ensure_added_columns() -> None:
    """Adiciona colunas novas a tabelas já existentes (migração idempotente e aditiva)."""
    with engine.begin() as connection:
        for table, columns in _ADDED_COLUMNS.items():
            existing = {
                row[1]
                for row in connection.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
            }
            if not existing:
                continue  # tabela ainda não existe: `create_all` trata dela por inteiro
            for name, sql_type in columns:
                if name not in existing:
                    connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}")


def init_db() -> None:
    """Inicializa as tabelas da base de dados com as restrições ACID."""
    ensure_app_directories()
    Base.metadata.create_all(bind=engine)
    _ensure_added_columns()


def get_db():
    """Dependência do FastAPI para disponibilização de sessão de base de dados."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


