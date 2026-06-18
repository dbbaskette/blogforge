"""github_identity — add github_id/login/avatar; relax email + password_hash."""
from alembic import op
import sqlalchemy as sa

revision = "0015_github_identity"
down_revision = "0014_voice_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("github_id", sa.BigInteger(), nullable=True))
        b.add_column(sa.Column("github_login", sa.String(length=100), nullable=True))
        b.add_column(sa.Column("avatar_url", sa.String(length=512), nullable=True))
        b.alter_column("password_hash", existing_type=sa.Text(), nullable=True)
        b.alter_column("email", existing_type=sa.String(length=320), nullable=True)
        b.create_index("ix_users_github_id", ["github_id"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.drop_index("ix_users_github_id")
        b.drop_column("avatar_url")
        b.drop_column("github_login")
        b.drop_column("github_id")
        b.alter_column("email", existing_type=sa.String(length=320), nullable=False)
        b.alter_column("password_hash", existing_type=sa.Text(), nullable=False)
