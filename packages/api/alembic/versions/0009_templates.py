"""templates — reusable idea defaults for new drafts

Revision ID: 0009_templates
Revises: 0008_section_versions
Create Date: 2026-05-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_templates"
down_revision: str | None = "0008_section_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("topic", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("pack_slug", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("target_words", sa.Integer(), nullable=False, server_default="1500"),
        sa.Column("format", sa.String(length=64), nullable=True),
        sa.Column("bullets", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_templates_user_id", "templates", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_templates_user_id", table_name="templates")
    op.drop_table("templates")
