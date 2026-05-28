"""linkedin_connections + linkedin_posts tables

Revision ID: 0004_linkedin
Revises: 0003_research_stage_and_refs
Create Date: 2026-05-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0004_linkedin"
down_revision: str | None = "0003_research_stage_and_refs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "linkedin_connections",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("member_urn", sa.String(128), nullable=False),
        sa.Column("member_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("encrypted_access_token", sa.Text(), nullable=False),
        sa.Column("scope", sa.String(255), nullable=False, server_default=""),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )

    json_type = JSONB().with_variant(sa.JSON(), "sqlite")

    op.create_table(
        "linkedin_posts",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=True),
        sa.Column("post_urn", sa.String(128), nullable=False),
        sa.Column("commentary", sa.Text(), nullable=False, server_default=""),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_stats", json_type, nullable=True),
        sa.Column("last_stats_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["draft_id"], ["drafts.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_linkedin_posts_user_id", "linkedin_posts", ["user_id"])
    op.create_index("ix_linkedin_posts_draft_id", "linkedin_posts", ["draft_id"])


def downgrade() -> None:
    op.drop_index("ix_linkedin_posts_draft_id", table_name="linkedin_posts")
    op.drop_index("ix_linkedin_posts_user_id", table_name="linkedin_posts")
    op.drop_table("linkedin_posts")
    op.drop_table("linkedin_connections")
