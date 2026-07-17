"""Track the GitHub path and blob revision of a published hero image."""

import sqlalchemy as sa
from alembic import op

revision = "0019_published_hero_metadata"
down_revision = "0018_github_publishing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drafts", sa.Column("published_hero_path", sa.String(length=768), nullable=True))
    op.add_column("drafts", sa.Column("published_hero_sha", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("drafts", "published_hero_sha")
    op.drop_column("drafts", "published_hero_path")
