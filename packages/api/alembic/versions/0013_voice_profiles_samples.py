"""voice_profiles + voice_samples — per-user voice profile and writing samples

Revision ID: 0013_voice_profiles_samples
Revises: 0012_draft_hero_image_key
Create Date: 2026-06-16

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_voice_profiles_samples"
down_revision: str | None = "0012_draft_hero_image_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "voice_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False, server_default="My Voice"),
        sa.Column("persona_identity", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("persona_one_line", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("persona_tone", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("rules", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("distilled_style_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("distilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_voice_profiles_user_id"),
    )
    op.create_index(
        "ix_voice_profiles_user_id", "voice_profiles", ["user_id"], unique=False
    )

    op.create_table(
        "voice_samples",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("source_url", sa.String(length=2000), nullable=True),
        sa.Column("original_filename", sa.String(length=300), nullable=True),
        sa.Column("s3_key", sa.String(length=400), nullable=False),
        sa.Column("extracted_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "exemplar", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
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
        "ix_voice_samples_profile_id", "voice_samples", ["profile_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_voice_samples_profile_id", table_name="voice_samples")
    op.drop_table("voice_samples")
    op.drop_index("ix_voice_profiles_user_id", table_name="voice_profiles")
    op.drop_table("voice_profiles")
