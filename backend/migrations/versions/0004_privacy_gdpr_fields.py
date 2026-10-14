"""Adição de campos de consentimento, retenção e conformidade com o RGPD.

Revision ID: 0004_privacy_gdpr_fields
Revises: 0003_indexes_and_constraints
Create Date: 2026-10-14

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_privacy_gdpr_fields"
down_revision: str | Sequence[str] | None = "0003_indexes_and_constraints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. athletes: consentimento, retenção e soft-delete
    if "athletes" in tables:
        cols = {col["name"] for col in inspector.get_columns("athletes")}
        with op.batch_alter_table("athletes") as batch_op:
            if "consent_at" not in cols:
                batch_op.add_column(sa.Column("consent_at", sa.DateTime(), nullable=True))
            if "consent_version" not in cols:
                batch_op.add_column(sa.Column("consent_version", sa.String(length=20), nullable=True))
            if "consent_scope" not in cols:
                batch_op.add_column(sa.Column("consent_scope", sa.Text(), nullable=True))
            if "deleted_at" not in cols:
                batch_op.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
            if "retention_until" not in cols:
                batch_op.add_column(sa.Column("retention_until", sa.DateTime(), nullable=True))

    # 2. fit_sessions: flag para permissão de persistência biométrica (data minimization)
    if "fit_sessions" in tables:
        cols = {col["name"] for col in inspector.get_columns("fit_sessions")}
        if "store_landmarks" not in cols:
            with op.batch_alter_table("fit_sessions") as batch_op:
                batch_op.add_column(
                    sa.Column("store_landmarks", sa.Boolean(), server_default=sa.text("0"), nullable=False)
                )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "fit_sessions" in tables:
        cols = {col["name"] for col in inspector.get_columns("fit_sessions")}
        if "store_landmarks" in cols:
            with op.batch_alter_table("fit_sessions") as batch_op:
                batch_op.drop_column("store_landmarks")

    if "athletes" in tables:
        cols = {col["name"] for col in inspector.get_columns("athletes")}
        with op.batch_alter_table("athletes") as batch_op:
            for col_name in ["retention_until", "deleted_at", "consent_scope", "consent_version", "consent_at"]:
                if col_name in cols:
                    batch_op.drop_column(col_name)
