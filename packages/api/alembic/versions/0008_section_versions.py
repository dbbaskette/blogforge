"""section_versions — per-section snapshot history for revert

Revision ID: 0008_section_versions
Revises: 0007_user_session_version
Create Date: 2026-05-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_section_versions"
down_revision: str | None = "0007_user_session_version"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "section_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("section_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("content_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ready"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="regenerate"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["draft_id"], ["drafts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_section_versions_draft_id", "section_versions", ["draft_id"], unique=False
    )
    op.create_index(
        "ix_section_versions_section_id", "section_versions", ["section_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_section_versions_section_id", table_name="section_versions")
    op.drop_index("ix_section_versions_draft_id", table_name="section_versions")
    op.drop_table("section_versions")
