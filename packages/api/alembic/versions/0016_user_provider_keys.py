"""user_provider_keys — per-user keys; migrate global keys to the admin user."""
from alembic import op
import sqlalchemy as sa

revision = "0016_user_provider_keys"
down_revision = "0015_github_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_provider_keys",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("provider", sa.String(length=32), primary_key=True),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        INSERT INTO user_provider_keys (user_id, provider, encrypted_key, created_at, updated_at)
        SELECT u.id, pk.provider, pk.encrypted_key, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM provider_keys pk
        CROSS JOIN (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1) u
        """
    )
    op.drop_table("provider_keys")


def downgrade() -> None:
    op.create_table(
        "provider_keys",
        sa.Column("provider", sa.String(length=32), primary_key=True),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.drop_table("user_provider_keys")
