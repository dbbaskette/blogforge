"""drafts.hero_image_key — S3 key of the AI-generated hero image

Revision ID: 0012_draft_hero_image_key
Revises: 0011_draft_tags
Create Date: 2026-06-01

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_draft_hero_image_key"
down_revision: str | None = "0011_draft_tags"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "drafts",
        sa.Column("hero_image_key", sa.String(256), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("drafts", "hero_image_key")
