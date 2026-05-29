"""library_references — user-scoped references reusable across drafts

Revision ID: 0010_library_references
Revises: 0009_templates
Create Date: 2026-05-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_library_references"
down_revision: str | None = "0009_templates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "library_references",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("original_filename", sa.String(length=500), nullable=True),
        sa.Column("original_ext", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("extracted_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_library_references_user_id", "library_references", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_library_references_user_id", table_name="library_references")
    op.drop_table("library_references")
