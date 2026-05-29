"""Postgres-backed template store. User-scoped, like SqlDraftStore."""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import Draft as DraftRow
from blogforge.db.models import Template as TemplateRow
from blogforge.templates.models import Template, TemplateInput


def _template_from_row(row: TemplateRow) -> Template:
    return Template(
        id=str(row.id),
        name=row.name,
        topic=row.topic,
        pack_slug=row.pack_slug,
        provider=row.provider,  # type: ignore[arg-type]
        model=row.model,
        target_words=row.target_words,
        format=row.format,
        bullets=list(row.bullets or []),
        notes=row.notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class TemplateStore:
    """Per-user template store."""

    async def list_for_user(self, user_id: UUID) -> list[Template]:
        async with get_sessionmaker()() as session:
            rows = (
                await session.execute(
                    select(TemplateRow)
                    .where(TemplateRow.user_id == user_id)
                    .order_by(TemplateRow.updated_at.desc())
                )
            ).scalars().all()
            return [_template_from_row(r) for r in rows]

    async def create(self, *, user_id: UUID, data: TemplateInput) -> Template:
        async with get_sessionmaker()() as session:
            row = TemplateRow(
                user_id=user_id,
                name=data.name,
                topic=data.topic,
                pack_slug=data.pack_slug,
                provider=data.provider,
                model=data.model,
                target_words=data.target_words,
                format=data.format,
                bullets=list(data.bullets),
                notes=data.notes,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return _template_from_row(row)

    async def create_from_draft(
        self, draft_id: str, *, user_id: UUID, name: str
    ) -> Template | None:
        """Build a template from an existing draft's idea defaults. Returns
        None if the draft isn't found / not owned."""
        try:
            duuid = UUID(draft_id)
        except ValueError:
            return None
        async with get_sessionmaker()() as session:
            draft = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == duuid, DraftRow.user_id == user_id
                    )
                )
            ).scalar_one_or_none()
            if draft is None:
                return None
            idea = draft.idea or {}
            row = TemplateRow(
                user_id=user_id,
                name=name,
                topic=idea.get("topic", ""),
                pack_slug=idea.get("pack_slug", ""),
                provider=idea.get("provider", "anthropic"),
                model=idea.get("model", ""),
                target_words=idea.get("target_words", 1500),
                format=idea.get("format"),
                bullets=list(idea.get("bullets") or []),
                notes=idea.get("notes", ""),
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return _template_from_row(row)

    async def delete(self, template_id: str, *, user_id: UUID) -> bool:
        try:
            tuuid = UUID(template_id)
        except ValueError:
            return False
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(TemplateRow).where(
                        TemplateRow.id == tuuid, TemplateRow.user_id == user_id
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            await session.delete(row)
            await session.commit()
            return True
