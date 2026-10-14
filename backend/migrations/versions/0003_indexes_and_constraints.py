"""Adição de índices de performance e constraints de integridade referencial e valores clínicos.

Revision ID: 0003_indexes_and_constraints
Revises: 0002_handlebar_and_cleats
Create Date: 2026-10-13

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_indexes_and_constraints"
down_revision: str | Sequence[str] | None = "0002_handlebar_and_cleats"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. posture_snapshots
    if "posture_snapshots" in tables:
        indices = {idx["name"] for idx in inspector.get_indexes("posture_snapshots")}
        if "ix_posture_snapshots_session_id" not in indices:
            op.create_index(
                "ix_posture_snapshots_session_id",
                "posture_snapshots",
                ["session_id"],
                unique=False,
            )

    # 2. fit_sessions
    if "fit_sessions" in tables:
        indices = {idx["name"] for idx in inspector.get_indexes("fit_sessions")}
        if "ix_fit_sessions_athlete_started" not in indices:
            op.create_index(
                "ix_fit_sessions_athlete_started",
                "fit_sessions",
                ["athlete_id", sa.text("started_at DESC")],
                unique=False,
            )
        with op.batch_alter_table("fit_sessions") as batch_op:
            batch_op.create_check_constraint(
                "check_fit_sessions_status",
                "status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')",
            )

    # 3. bikes
    if "bikes" in tables:
        indices = {idx["name"] for idx in inspector.get_indexes("bikes")}
        if "ix_bikes_athlete_id" not in indices:
            op.create_index(
                "ix_bikes_athlete_id",
                "bikes",
                ["athlete_id"],
                unique=False,
            )
        with op.batch_alter_table("bikes") as batch_op:
            batch_op.create_check_constraint(
                "check_bikes_type",
                "bike_type IN ('road', 'mtb', 'tt', 'gravel')",
            )

    # 4. athletes
    if "athletes" in tables:
        with op.batch_alter_table("athletes") as batch_op:
            batch_op.create_check_constraint(
                "check_athletes_flexibility",
                "flexibility IN ('low', 'medium', 'high')",
            )
            batch_op.create_check_constraint(
                "check_athletes_riding_style",
                "riding_style IN ('road', 'mtb', 'tt', 'gravel')",
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "bikes" in tables:
        with op.batch_alter_table("bikes") as batch_op:
            batch_op.drop_constraint("check_bikes_type", type_="check")
        op.drop_index("ix_bikes_athlete_id", table_name="bikes")

    if "athletes" in tables:
        with op.batch_alter_table("athletes") as batch_op:
            batch_op.drop_constraint("check_athletes_riding_style", type_="check")
            batch_op.drop_constraint("check_athletes_flexibility", type_="check")

    if "fit_sessions" in tables:
        with op.batch_alter_table("fit_sessions") as batch_op:
            batch_op.drop_constraint("check_fit_sessions_status", type_="check")
        op.drop_index("ix_fit_sessions_athlete_started", table_name="fit_sessions")

    if "posture_snapshots" in tables:
        op.drop_index("ix_posture_snapshots_session_id", table_name="posture_snapshots")
