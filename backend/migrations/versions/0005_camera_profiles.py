"""Criação da tabela de perfis de calibração ótica de câmara.

Revision ID: 0005_camera_profiles
Revises: 0004_privacy_gdpr_fields
Create Date: 2026-10-14

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_camera_profiles"
down_revision: str | Sequence[str] | None = "0004_privacy_gdpr_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "camera_profiles" not in tables:
        op.create_table(
            "camera_profiles",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("camera_id", sa.String(length=100), nullable=False),
            sa.Column("width", sa.Integer(), nullable=False),
            sa.Column("height", sa.Integer(), nullable=False),
            sa.Column("camera_matrix_json", sa.Text(), nullable=False),
            sa.Column("dist_coeffs_json", sa.Text(), nullable=False),
            sa.Column("rms_error_px", sa.Float(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            "ix_camera_profiles_cam_res",
            "camera_profiles",
            ["camera_id", "width", "height"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "camera_profiles" in tables:
        op.drop_index("ix_camera_profiles_cam_res", table_name="camera_profiles")
        op.drop_table("camera_profiles")
