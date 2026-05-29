"""Postgres-backed draft store. Replaces the JSON-on-disk DraftStore.

Every method takes a user_id and scopes its query so users can never see
or mutate each other's drafts. Cross-user attempts silently 404 (return
None or skip) rather than 403, to avoid leaking ID existence.
"""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import Draft as DraftRow
from blogforge.db.models import Section as SectionRow
from blogforge.db.models import SectionVersion as SectionVersionRow
from blogforge.drafts.models import (
    Draft,
    DraftSummary,
    IdeaInput,
    IdeationMessage,
    OutlineProposal,
    Reference,
    Section,
    SectionVersion,
)

# Per-section cap on stored version snapshots; older rows are pruned on insert.
_MAX_VERSIONS_PER_SECTION = 10


def _coerce_stage(raw: str) -> str:
    """Map the legacy 'idea' stage to its Phase B name 'research'.

    The schema migration rewrites rows in place; this is the runtime
    safety net for any rows the migration missed (e.g. test fixtures
    that pass stage='idea' explicitly)."""
    return "research" if raw == "idea" else raw


def _draft_from_row(row: DraftRow) -> Draft:
    return Draft(
        id=str(row.id),
        created_at=row.created_at,
        updated_at=row.updated_at,
        title=row.title,
        stage=_coerce_stage(row.stage),  # type: ignore[arg-type]
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
        references=[
            Reference(
                id=r.id,
                kind=r.kind,  # type: ignore[arg-type]
                name=r.name,
                url=r.url,
                original_filename=r.original_filename,
                extracted_chars=r.extracted_chars,
                added_at=r.added_at,
            )
            for r in sorted(row.references, key=lambda r: r.added_at)
        ],
        ideation_messages=[
            IdeationMessage(
                id=m.id,
                position=m.position,
                role=m.role,  # type: ignore[arg-type]
                content=m.content,
                proposed_outline=(
                    OutlineProposal.model_validate(m.proposed_outline)
                    if m.proposed_outline
                    else None
                ),
                timestamp=m.timestamp,
            )
            for m in sorted(row.ideation_messages, key=lambda m: m.position)
        ],
        tags=list(row.tags or []),
    )


def _section_version_from_row(row: SectionVersionRow) -> SectionVersion:
    return SectionVersion(
        id=str(row.id),
        section_id=row.section_id,
        title=row.title,
        content_md=row.content_md,
        word_count=row.word_count,
        status=row.status,  # type: ignore[arg-type]
        source=row.source,  # type: ignore[arg-type]
        created_at=row.created_at,
    )


async def _prune_section_versions(
    session: AsyncSession, draft_uuid: UUID, section_id: str
) -> None:
    """Delete all but the most-recent _MAX_VERSIONS_PER_SECTION snapshots."""
    rows = (
        await session.execute(
            select(SectionVersionRow)
            .where(
                SectionVersionRow.draft_id == draft_uuid,
                SectionVersionRow.section_id == section_id,
            )
            .order_by(SectionVersionRow.created_at.desc())
        )
    ).scalars().all()
    for old in rows[_MAX_VERSIONS_PER_SECTION:]:
        await session.delete(old)


def _summary_from_row(row: DraftRow) -> DraftSummary:
    word_count = sum(s.word_count for s in row.sections) if row.sections else 0
    return DraftSummary(
        id=str(row.id),
        title=row.title,
        stage=row.stage,  # type: ignore[arg-type]
        pack_slug=row.idea.get("pack_slug", "") if row.idea else "",
        updated_at=row.updated_at,
        word_count=word_count,
        tags=list(row.tags or []),
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
            await session.refresh(row, ["sections", "references", "ideation_messages"])
            return _draft_from_row(row)

    async def create(self, *, user_id: UUID, idea: IdeaInput) -> Draft:
        async with get_sessionmaker()() as session:
            row = DraftRow(
                user_id=user_id,
                title=idea.topic,
                stage="research",
                idea=idea.model_dump(),
            )
            session.add(row)
            await session.commit()
            await session.refresh(row, ["sections", "references", "ideation_messages"])
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
            row.tags = list(draft.tags)
            row.updated_at = datetime.now(UTC)

            # Replace sections in bulk.
            await session.refresh(row, ["sections"])
            existing_by_id = {s.id: s for s in row.sections}

            # Two-phase position update to avoid tripping the (draft_id, position)
            # UNIQUE constraint when a reorder shuffles existing rows.
            # Phase 1: bump every existing row to a guaranteed-unique negative slot.
            for offset, er in enumerate(row.sections):
                er.position = -(offset + 1)
            await session.flush()

            # Phase 2: assign final positions + apply field updates.
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
            await session.refresh(row, ["sections", "references", "ideation_messages"])
            return _draft_from_row(row)

    async def set_stage(
        self, draft_id: str, stage: str, *, user_id: UUID
    ) -> Draft | None:
        """Move a draft to a stage explicitly (allows regressing back to
        'research' to rework). Only the stage pointer changes — outline,
        sections, and ideation history are preserved. None if not found."""
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
            row.stage = stage
            row.updated_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(row, ["sections", "references", "ideation_messages"])
            return _draft_from_row(row)

    async def set_tags(
        self, draft_id: str, tags: list[str], *, user_id: UUID
    ) -> Draft | None:
        """Replace a draft's tags (lightweight — doesn't touch sections).
        Returns the updated draft, or None if not found / not owned."""
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
            row.tags = list(tags)
            row.updated_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(row, ["sections", "references", "ideation_messages"])
            return _draft_from_row(row)

    @staticmethod
    def assemble_markdown(draft: Draft) -> str:
        parts: list[str] = []
        if draft.title:
            parts.append(f"# {draft.title}\n")
        if draft.outline and draft.outline.opening_hook:
            parts.append(draft.outline.opening_hook.strip() + "\n")
        for section in draft.sections:
            parts.append(f"## {section.title}\n")
            if section.content_md.strip():
                parts.append(section.content_md.strip() + "\n")
        return "\n".join(parts) + "\n"

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

    async def list_trashed(self, user_id: UUID) -> list[DraftSummary]:
        """Soft-deleted drafts, most-recently-trashed first."""
        async with get_sessionmaker()() as session:
            rows = (
                await session.execute(
                    select(DraftRow)
                    .where(DraftRow.user_id == user_id, DraftRow.deleted_at.is_not(None))
                    .order_by(DraftRow.deleted_at.desc())
                )
            ).scalars().all()
            for r in rows:
                await session.refresh(r, ["sections"])
            return [_summary_from_row(r) for r in rows]

    async def restore(self, draft_id: str, *, user_id: UUID) -> Draft | None:
        """Clear deleted_at on a trashed draft. Returns the restored draft,
        or None if not found / not owned / not actually trashed."""
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
                        DraftRow.deleted_at.is_not(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            row.deleted_at = None
            await session.commit()
            await session.refresh(row, ["sections", "references", "ideation_messages"])
            return _draft_from_row(row)

    async def hard_delete(self, draft_id: str, *, user_id: UUID) -> bool:
        """Permanently remove a draft (and its cascaded children). Returns
        True if a row was deleted. Only operates on already-trashed drafts."""
        try:
            uuid = UUID(draft_id)
        except ValueError:
            return False
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == uuid,
                        DraftRow.user_id == user_id,
                        DraftRow.deleted_at.is_not(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            await session.delete(row)
            await session.commit()
            return True

    async def _owns_draft(self, session: AsyncSession, draft_uuid: UUID, user_id: UUID) -> bool:
        owner = (
            await session.execute(
                select(DraftRow.id).where(
                    DraftRow.id == draft_uuid, DraftRow.user_id == user_id
                )
            )
        ).scalar_one_or_none()
        return owner is not None

    async def add_section_version(
        self,
        draft_id: str,
        section_id: str,
        *,
        user_id: UUID,
        title: str,
        content_md: str,
        word_count: int,
        status: str,
        source: str,
    ) -> None:
        """Snapshot a section's prior state before it's overwritten.

        No-op when the draft isn't owned by ``user_id`` or when ``content_md``
        is blank (an empty section has nothing worth keeping)."""
        if not content_md.strip():
            return
        try:
            duuid = UUID(draft_id)
        except ValueError:
            return
        async with get_sessionmaker()() as session:
            if not await self._owns_draft(session, duuid, user_id):
                return
            session.add(
                SectionVersionRow(
                    draft_id=duuid,
                    section_id=section_id,
                    title=title,
                    content_md=content_md,
                    word_count=word_count,
                    status=status,
                    source=source,
                )
            )
            await session.flush()
            await _prune_section_versions(session, duuid, section_id)
            await session.commit()

    async def list_section_versions(
        self, draft_id: str, section_id: str, *, user_id: UUID
    ) -> list[SectionVersion]:
        """Stored snapshots for a section, newest first. [] if not owned."""
        try:
            duuid = UUID(draft_id)
        except ValueError:
            return []
        async with get_sessionmaker()() as session:
            if not await self._owns_draft(session, duuid, user_id):
                return []
            rows = (
                await session.execute(
                    select(SectionVersionRow)
                    .where(
                        SectionVersionRow.draft_id == duuid,
                        SectionVersionRow.section_id == section_id,
                    )
                    .order_by(SectionVersionRow.created_at.desc())
                )
            ).scalars().all()
            return [_section_version_from_row(r) for r in rows]

    async def revert_section(
        self, draft_id: str, section_id: str, version_id: str, *, user_id: UUID
    ) -> Draft | None:
        """Restore a section to a stored version. Snapshots the current
        content first (source='revert') so the revert is itself undoable.

        Returns the updated draft, or None if the draft / section / version
        isn't found or isn't owned by ``user_id``."""
        try:
            duuid = UUID(draft_id)
            vuuid = UUID(version_id)
        except ValueError:
            return None
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == duuid,
                        DraftRow.user_id == user_id,
                        DraftRow.deleted_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            version = (
                await session.execute(
                    select(SectionVersionRow).where(
                        SectionVersionRow.id == vuuid,
                        SectionVersionRow.draft_id == duuid,
                        SectionVersionRow.section_id == section_id,
                    )
                )
            ).scalar_one_or_none()
            if version is None:
                return None
            await session.refresh(row, ["sections"])
            section = next((s for s in row.sections if s.id == section_id), None)
            if section is None:
                return None
            # Snapshot the live content first so the revert can be undone.
            if section.content_md.strip():
                session.add(
                    SectionVersionRow(
                        draft_id=duuid,
                        section_id=section_id,
                        title=section.title,
                        content_md=section.content_md,
                        word_count=section.word_count,
                        status=section.status,
                        source="revert",
                    )
                )
                await session.flush()
                await _prune_section_versions(session, duuid, section_id)
            # Apply the chosen version.
            section.content_md = version.content_md
            section.word_count = version.word_count
            section.status = "edited"
            section.last_error = None
            row.updated_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(row, ["sections", "references", "ideation_messages"])
            return _draft_from_row(row)
