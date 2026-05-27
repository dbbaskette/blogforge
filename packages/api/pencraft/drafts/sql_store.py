"""Postgres-backed draft store. Replaces the JSON-on-disk DraftStore.

Every method takes a user_id and scopes its query so users can never see
or mutate each other's drafts. Cross-user attempts silently 404 (return
None or skip) rather than 403, to avoid leaking ID existence.
"""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from pencraft.db.engine import get_sessionmaker
from pencraft.db.models import Draft as DraftRow
from pencraft.db.models import Section as SectionRow
from pencraft.drafts.models import (
    Draft,
    DraftSummary,
    IdeaInput,
    OutlineProposal,
    Section,
)


def _draft_from_row(row: DraftRow) -> Draft:
    return Draft(
        id=str(row.id),
        created_at=row.created_at,
        updated_at=row.updated_at,
        title=row.title,
        stage=row.stage,  # type: ignore[arg-type]
        idea=IdeaInput.model_validate(row.idea),
        outline=(OutlineProposal.model_validate(row.outline) if row.outline else None),
        sections=[
            Section(
                id=s.id,
                title=s.title,
                brief=s.brief,
                content_md=s.content_md,
                status=s.status,  # type: ignore[arg-type]
                last_generated_at=s.last_generated_at,
                last_error=s.last_error,
                word_count=s.word_count,
            )
            for s in sorted(row.sections, key=lambda s: s.position)
        ],
    )


def _summary_from_row(row: DraftRow) -> DraftSummary:
    word_count = sum(s.word_count for s in row.sections) if row.sections else 0
    return DraftSummary(
        id=str(row.id),
        title=row.title,
        stage=row.stage,  # type: ignore[arg-type]
        pack_slug=row.idea.get("pack_slug", "") if row.idea else "",
        updated_at=row.updated_at,
        word_count=word_count,
    )


class SqlDraftStore:
    """Per-user Postgres-backed draft store."""

    async def list_for_user(self, user_id: UUID) -> list[DraftSummary]:
        async with get_sessionmaker()() as session:
            rows = (
                await session.execute(
                    select(DraftRow)
                    .where(DraftRow.user_id == user_id, DraftRow.deleted_at.is_(None))
                    .order_by(DraftRow.updated_at.desc())
                )
            ).scalars().all()
            # Eagerly load sections for word counts.
            for r in rows:
                await session.refresh(r, ["sections"])
            return [_summary_from_row(r) for r in rows]

    async def get(self, draft_id: str, *, user_id: UUID) -> Draft | None:
        try:
            uuid = UUID(draft_id)
        except ValueError:
            return None
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == uuid,
                        DraftRow.user_id == user_id,
                        DraftRow.deleted_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            await session.refresh(row, ["sections"])
            return _draft_from_row(row)

    async def create(self, *, user_id: UUID, idea: IdeaInput) -> Draft:
        async with get_sessionmaker()() as session:
            row = DraftRow(
                user_id=user_id,
                title=idea.topic,
                stage="idea",
                idea=idea.model_dump(),
            )
            session.add(row)
            await session.commit()
            await session.refresh(row, ["sections"])
            return _draft_from_row(row)

    async def update(self, draft_id: str, draft: Draft, *, user_id: UUID) -> Draft | None:
        try:
            uuid = UUID(draft_id)
        except ValueError:
            return None
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == uuid, DraftRow.user_id == user_id
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            row.title = draft.title
            row.stage = draft.stage
            row.idea = draft.idea.model_dump()
            row.outline = draft.outline.model_dump() if draft.outline else None
            row.updated_at = datetime.now(UTC)

            # Replace sections in bulk.
            await session.refresh(row, ["sections"])
            existing_by_id = {s.id: s for s in row.sections}
            for pos, s in enumerate(draft.sections):
                if s.id in existing_by_id:
                    er = existing_by_id.pop(s.id)
                    er.position = pos
                    er.title = s.title
                    er.brief = s.brief
                    er.content_md = s.content_md
                    er.status = s.status
                    er.last_generated_at = s.last_generated_at
                    er.last_error = s.last_error
                    er.word_count = s.word_count
                else:
                    session.add(
                        SectionRow(
                            id=s.id,
                            draft_id=row.id,
                            position=pos,
                            title=s.title,
                            brief=s.brief,
                            content_md=s.content_md,
                            status=s.status,
                            last_generated_at=s.last_generated_at,
                            last_error=s.last_error,
                            word_count=s.word_count,
                        )
                    )
            # Anything left in existing_by_id was removed by the user.
            for orphan in existing_by_id.values():
                await session.delete(orphan)
            await session.commit()
            await session.refresh(row, ["sections"])
            return _draft_from_row(row)

    async def delete(self, draft_id: str, *, user_id: UUID) -> None:
        try:
            uuid = UUID(draft_id)
        except ValueError:
            return
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == uuid, DraftRow.user_id == user_id
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return
            row.deleted_at = datetime.now(UTC)
            await session.commit()
