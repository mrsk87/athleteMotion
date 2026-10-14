"""Adição de colunas de geometria de cockpit e cleat position à tabela bikes.

Revision ID: 0002_handlebar_and_cleats
Revises: 0001_baseline
Create Date: 2026-10-13

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_handlebar_and_cleats"
down_revision: str | Sequence[str] | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "bikes" in tables:
        existing_cols = {col["name"] for col in inspector.get_columns("bikes")}
        with op.batch_alter_table("bikes") as batch_op:
            if "top_tube_mm" not in existing_cols:
                batch_op.add_column(sa.Column("top_tube_mm", sa.Float(), nullable=True))
            if "handlebar_reach_mm" not in existing_cols:
                batch_op.add_column(sa.Column("handlebar_reach_mm", sa.Float(), nullable=True))
            if "handlebar_drop_mm" not in existing_cols:
                batch_op.add_column(sa.Column("handlebar_drop_mm", sa.Float(), nullable=True))
            if "cleat_position" not in existing_cols:
                batch_op.add_column(sa.Column("cleat_position", sa.String(length=30), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "bikes" in tables:
        existing_cols = {col["name"] for col in inspector.get_columns("bikes")}
        with op.batch_alter_table("bikes") as batch_op:
            if "cleat_position" in existing_cols:
                batch_op.drop_column("cleat_position")
            if "handlebar_drop_mm" in existing_cols:
                batch_op.drop_column("handlebar_drop_mm")
            if "handlebar_reach_mm" in existing_cols:
                batch_op.drop_column("handlebar_reach_mm")
            if "top_tube_mm" in existing_cols:
                batch_op.drop_column("top_tube_mm")
