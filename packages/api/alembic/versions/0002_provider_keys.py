"""provider_keys table — admin-managed encrypted LLM credentials

Revision ID: 0002_provider_keys
Revises: 0001_initial
Create Date: 2026-05-27

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_provider_keys"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "provider_keys",
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("provider"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
    )


def downgrade() -> None:
    op.drop_table("provider_keys")
