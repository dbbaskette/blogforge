"""drafts.tags — free-form labels for organizing the drafts list

Revision ID: 0011_draft_tags
Revises: 0010_library_references
Create Date: 2026-05-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_draft_tags"
down_revision: str | None = "0010_library_references"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "drafts",
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("drafts", "tags")
