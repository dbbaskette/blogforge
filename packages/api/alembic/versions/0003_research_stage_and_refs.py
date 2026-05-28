"""references + ideation_messages tables; rename stage idea->research

Revision ID: 0003_research_stage_and_refs
Revises: 0002_provider_keys
Create Date: 2026-05-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0003_research_stage_and_refs"
down_revision: str | None = "0002_provider_keys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. New tables — references + ideation_messages.
    op.create_table(
        "references",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("original_filename", sa.String(500), nullable=True),
        sa.Column("extracted_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["draft_id"], ["drafts.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_references_draft_id", "references", ["draft_id"])

    json_type = JSONB().with_variant(sa.JSON(), "sqlite")

    op.create_table(
        "ideation_messages",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("proposed_outline", json_type, nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["draft_id"], ["drafts.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("draft_id", "position", name="uq_ideation_position"),
    )
    op.create_index("ix_ideation_messages_draft_id", "ideation_messages", ["draft_id"])

    # 2. Stage rename: any existing rows at "idea" become "research".
    op.execute("UPDATE drafts SET stage = 'research' WHERE stage = 'idea'")

    # 3. Change the column default. SQLite ignores ALTER DEFAULT on existing
    # columns (defaults are baked at insert time on SQLite, and we set the new
    # default at the ORM level in models.py anyway), so wrap this in a
    # dialect check.
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.alter_column(
            "drafts",
            "stage",
            server_default="research",
            existing_type=sa.String(16),
            existing_nullable=False,
        )


def downgrade() -> None:
    op.drop_index("ix_ideation_messages_draft_id", table_name="ideation_messages")
    op.drop_table("ideation_messages")
    op.drop_index("ix_references_draft_id", table_name="references")
    op.drop_table("references")
    op.execute("UPDATE drafts SET stage = 'idea' WHERE stage = 'research'")
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.alter_column(
            "drafts",
            "stage",
            server_default="idea",
            existing_type=sa.String(16),
            existing_nullable=False,
        )
