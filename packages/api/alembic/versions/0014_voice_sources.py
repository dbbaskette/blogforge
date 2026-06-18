"""voice_sources — profile-level background/context source URLs

Revision ID: 0014_voice_sources
Revises: 0013_voice_profiles_samples
Create Date: 2026-06-18

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_voice_sources"
down_revision: str | None = "0013_voice_profiles_samples"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "voice_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("url", sa.String(length=2000), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("s3_key", sa.String(length=400), nullable=False),
        sa.Column("extracted_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=8), nullable=False, server_default="ready"),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["profile_id"], ["voice_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_voice_sources_profile_id", "voice_sources", ["profile_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_voice_sources_profile_id", table_name="voice_sources")
    op.drop_table("voice_sources")
