"""Add the user's default writing provider."""

import sqlalchemy as sa
from alembic import op

revision = "0017_user_default_provider"
down_revision = "0016_user_provider_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("default_provider", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "default_provider")
