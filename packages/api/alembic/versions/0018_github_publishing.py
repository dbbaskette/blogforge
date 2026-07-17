"""Per-user GitHub publishing settings and draft publication metadata."""

import sqlalchemy as sa
from alembic import op

revision = "0018_github_publishing"
down_revision = "0017_user_default_provider"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_publishing_settings",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("owner", sa.String(length=100), nullable=False),
        sa.Column("repo", sa.String(length=100), nullable=False),
        sa.Column("branch", sa.String(length=256), nullable=False, server_default="main"),
        sa.Column(
            "content_dir", sa.String(length=512), nullable=False, server_default="content/posts"
        ),
        sa.Column(
            "frontmatter_preset", sa.String(length=16), nullable=False, server_default="hugo"
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("drafts", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("drafts", sa.Column("published_path", sa.String(length=768), nullable=True))
    op.add_column("drafts", sa.Column("published_sha", sa.String(length=64), nullable=True))
    op.add_column(
        "drafts", sa.Column("published_commit_url", sa.String(length=1024), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("drafts", "published_commit_url")
    op.drop_column("drafts", "published_sha")
    op.drop_column("drafts", "published_path")
    op.drop_column("drafts", "published_at")
    op.drop_table("user_publishing_settings")
