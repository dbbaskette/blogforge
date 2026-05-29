"""users.session_version for sign-out-everywhere / password change

Revision ID: 0007_user_session_version
Revises: 0006_drop_linkedin
Create Date: 2026-05-28

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_user_session_version"
down_revision: str | None = "0006_drop_linkedin"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "session_version")
