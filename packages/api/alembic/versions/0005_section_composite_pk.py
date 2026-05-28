"""sections PK: id -> composite (draft_id, id)

Section slugs ("the-pattern", "get-building", …) are LLM-generated and repeat
across drafts, so a global PK on `id` collides the moment two drafts share a
slug (e.g. accepting a second outline). The id is only unique *within* a
draft; make the PK composite.

Revision ID: 0005_section_composite_pk
Revises: 0004_linkedin
Create Date: 2026-05-28

"""
from collections.abc import Sequence

from alembic import op

revision: str = "0005_section_composite_pk"
down_revision: str | None = "0004_linkedin"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # SQLite can't ALTER a primary key in place; recreate the table via
        # batch mode with the composite PK. Fresh test DBs built from the ORM
        # metadata already use the composite PK, so this only matters for a
        # migrated-from-scratch sqlite (the migration smoke test).
        with op.batch_alter_table("sections", recreate="always") as batch:
            batch.create_primary_key("sections_pkey", ["draft_id", "id"])
        return
    op.drop_constraint("sections_pkey", "sections", type_="primary")
    op.create_primary_key("sections_pkey", "sections", ["draft_id", "id"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("sections", recreate="always") as batch:
            batch.create_primary_key("sections_pkey", ["id"])
        return
    op.drop_constraint("sections_pkey", "sections", type_="primary")
    op.create_primary_key("sections_pkey", "sections", ["id"])
