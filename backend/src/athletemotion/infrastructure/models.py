"""Modelos relacionais declarativos modernos em conformidade com SQLAlchemy 2.0."""

from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)

from athletemotion.infrastructure.security.cipher import EncryptedString, EncryptedText
from athletemotion.infrastructure.types import UTCDateTime


class Base(DeclarativeBase):
    """Base declarativa moderna do SQLAlchemy 2.0."""


class AthleteModel(Base):
    """Registo do atleta e medidas corporais antropométricas."""

    __tablename__ = "athletes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    height_cm: Mapped[float] = mapped_column(Float, nullable=False)
    inseam_cm: Mapped[float] = mapped_column(Float, nullable=False)  # Cavalo / entre-perna
    shoulder_width_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    torso_length_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    arm_length_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    flexibility: Mapped[str] = mapped_column(
        String(20), default="medium", server_default="medium", nullable=False
    )
    riding_style: Mapped[str] = mapped_column(
        String(20), default="road", server_default="road", nullable=False
    )
    consent_at: Mapped[datetime.datetime | None] = mapped_column(UTCDateTime, nullable=True)
    consent_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    consent_scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime.datetime | None] = mapped_column(UTCDateTime, nullable=True)
    retention_until: Mapped[datetime.datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        UTCDateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        nullable=False,
    )

    bikes: Mapped[list[BikeModel]] = relationship(
        "BikeModel", back_populates="athlete", cascade="all, delete-orphan"
    )
    sessions: Mapped[list[FitSessionModel]] = relationship(
        "FitSessionModel", back_populates="athlete", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("height_cm > 50.0 AND height_cm < 250.0", name="check_valid_height"),
        CheckConstraint("inseam_cm > 30.0 AND inseam_cm < height_cm", name="check_valid_inseam"),
        CheckConstraint(
            "flexibility IN ('low', 'medium', 'high')", name="check_athletes_flexibility"
        ),
        CheckConstraint(
            "riding_style IN ('road', 'mtb', 'tt', 'gravel')", name="check_athletes_riding_style"
        ),
    )


class BikeModel(Base):
    """Registo de medidas e componentes da bicicleta do atleta."""

    __tablename__ = "bikes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    athlete_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("athletes.id", ondelete="CASCADE"), nullable=False
    )
    bike_type: Mapped[str] = mapped_column(
        String(20), default="road", server_default="road", nullable=False
    )
    brand_model: Mapped[str] = mapped_column(
        String(100), default="Minha Bicicleta", server_default="Minha Bicicleta", nullable=False
    )
    frame_size_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_tube_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    handlebar_width_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    handlebar_reach_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    handlebar_drop_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    stem_length_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    crank_length_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_saddle_height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    cleat_position: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        UTCDateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        nullable=False,
    )

    athlete: Mapped[AthleteModel] = relationship("AthleteModel", back_populates="bikes")
    sessions: Mapped[list[FitSessionModel]] = relationship(
        "FitSessionModel", back_populates="bike", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("bike_type IN ('road', 'mtb', 'tt', 'gravel')", name="check_bikes_type"),
        Index("ix_bikes_athlete_id", "athlete_id"),
    )


class FitSessionModel(Base):
    """Sessão transacional de BikeFit contendo objetivos, métricas e diagnóstico."""

    __tablename__ = "fit_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    athlete_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("athletes.id", ondelete="CASCADE"), nullable=False
    )
    bike_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("bikes.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), default="IN_PROGRESS", server_default="IN_PROGRESS", nullable=False
    )
    store_landmarks: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )

    theoretical_saddle_height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_knee_min: Mapped[float] = mapped_column(
        Float, default=145.0, server_default="145.0", nullable=False
    )
    target_knee_max: Mapped[float] = mapped_column(
        Float, default=155.0, server_default="155.0", nullable=False
    )
    target_back_min: Mapped[float] = mapped_column(
        Float, default=40.0, server_default="40.0", nullable=False
    )
    target_back_max: Mapped[float] = mapped_column(
        Float, default=50.0, server_default="50.0", nullable=False
    )

    measured_avg_knee_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    measured_avg_back_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    measured_avg_arm_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    measured_avg_ankle_angle: Mapped[float | None] = mapped_column(Float, nullable=True)

    summary_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime.datetime] = mapped_column(
        UTCDateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        nullable=False,
    )
    completed_at: Mapped[datetime.datetime | None] = mapped_column(UTCDateTime, nullable=True)

    athlete: Mapped[AthleteModel] = relationship("AthleteModel", back_populates="sessions")
    bike: Mapped[BikeModel] = relationship("BikeModel", back_populates="sessions")
    snapshots: Mapped[list[PostureSnapshotModel]] = relationship(
        "PostureSnapshotModel", back_populates="session", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')", name="check_fit_sessions_status"
        ),
        Index("ix_fit_sessions_athlete_started", "athlete_id", started_at.desc()),
    )


class PostureSnapshotModel(Base):
    """Amostra instantânea de ângulos capturada durante a análise em tempo real."""

    __tablename__ = "posture_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("fit_sessions.id", ondelete="CASCADE"), nullable=False
    )
    frame_index: Mapped[int] = mapped_column(default=0, server_default="0", nullable=False)
    timestamp: Mapped[datetime.datetime] = mapped_column(
        UTCDateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        nullable=False,
    )

    knee_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    back_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    arm_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    ankle_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_compliant: Mapped[bool] = mapped_column(default=False, server_default="0", nullable=False)
    raw_landmarks_json: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)

    session: Mapped[FitSessionModel] = relationship("FitSessionModel", back_populates="snapshots")

    __table_args__ = (Index("ix_posture_snapshots_session_id", "session_id"),)


class CameraProfileModel(Base):
    """Perfil de calibração ótica e distorção de lente de câmara por resolução."""

    __tablename__ = "camera_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    camera_id: Mapped[str] = mapped_column(String(100), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    camera_matrix_json: Mapped[str] = mapped_column(Text, nullable=False)
    dist_coeffs_json: Mapped[str] = mapped_column(Text, nullable=False)
    rms_error_px: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        UTCDateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_camera_profiles_cam_res", "camera_id", "width", "height"),
    )
