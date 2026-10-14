"""Esquema baseline inicial com todas as tabelas originais.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-13

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_baseline"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Tabela de atletas
    op.create_table(
        "athletes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=120), nullable=True),
        sa.Column("height_cm", sa.Float(), nullable=False),
        sa.Column("inseam_cm", sa.Float(), nullable=False),
        sa.Column("shoulder_width_cm", sa.Float(), nullable=True),
        sa.Column("torso_length_cm", sa.Float(), nullable=True),
        sa.Column("arm_length_cm", sa.Float(), nullable=True),
        sa.Column("flexibility", sa.String(length=20), server_default="medium", nullable=False),
        sa.Column("riding_style", sa.String(length=20), server_default="road", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("height_cm > 50.0 AND height_cm < 250.0", name="check_valid_height"),
        sa.CheckConstraint("inseam_cm > 30.0 AND inseam_cm < height_cm", name="check_valid_inseam"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 2. Tabela de bicicletas original
    op.create_table(
        "bikes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("athlete_id", sa.String(length=36), nullable=False),
        sa.Column("bike_type", sa.String(length=20), server_default="road", nullable=False),
        sa.Column("brand_model", sa.String(length=100), server_default="Minha Bicicleta", nullable=False),
        sa.Column("frame_size_cm", sa.Float(), nullable=True),
        sa.Column("handlebar_width_mm", sa.Float(), nullable=True),
        sa.Column("stem_length_mm", sa.Float(), nullable=True),
        sa.Column("crank_length_mm", sa.Float(), nullable=True),
        sa.Column("current_saddle_height_cm", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 3. Tabela de sessões de bikefit
    op.create_table(
        "fit_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("athlete_id", sa.String(length=36), nullable=False),
        sa.Column("bike_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="IN_PROGRESS", nullable=False),
        sa.Column("theoretical_saddle_height_cm", sa.Float(), nullable=True),
        sa.Column("target_knee_min", sa.Float(), server_default="145.0", nullable=False),
        sa.Column("target_knee_max", sa.Float(), server_default="155.0", nullable=False),
        sa.Column("target_back_min", sa.Float(), server_default="40.0", nullable=False),
        sa.Column("target_back_max", sa.Float(), server_default="50.0", nullable=False),
        sa.Column("measured_avg_knee_angle", sa.Float(), nullable=True),
        sa.Column("measured_avg_back_angle", sa.Float(), nullable=True),
        sa.Column("measured_avg_arm_angle", sa.Float(), nullable=True),
        sa.Column("measured_avg_ankle_angle", sa.Float(), nullable=True),
        sa.Column("summary_json", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["bike_id"], ["bikes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 4. Tabela de capturas instantâneas (posture snapshots)
    op.create_table(
        "posture_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("frame_index", sa.Integer(), server_default="0", nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("knee_angle", sa.Float(), nullable=True),
        sa.Column("back_angle", sa.Float(), nullable=True),
        sa.Column("arm_angle", sa.Float(), nullable=True),
        sa.Column("ankle_angle", sa.Float(), nullable=True),
        sa.Column("is_compliant", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("raw_landmarks_json", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["fit_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("posture_snapshots")
    op.drop_table("fit_sessions")
    op.drop_table("bikes")
    op.drop_table("athletes")
