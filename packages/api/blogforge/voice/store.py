"""Postgres/SQLite-backed voice profile store.

Every method is async and scoped by user_id — a user can only ever
touch their own profile.  Cross-user access silently returns None or
is a no-op (same pattern as SqlDraftStore).

Name collision: the ORM rows and Pydantic models share names.  We
alias ORM rows to avoid shadowing the exported Pydantic types.
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import VoiceProfile as VoiceProfileRow
from blogforge.db.models import VoiceSample as VoiceSampleRow
from blogforge.voice.models import VoiceProfile, VoiceRules, VoiceSample

# ---------------------------------------------------------------------------
# Row → Pydantic mappers
# ---------------------------------------------------------------------------

def _sample_from_row(row: VoiceSampleRow) -> VoiceSample:
    return VoiceSample(
        id=str(row.id),
        kind=row.kind,  # type: ignore[arg-type]
        name=row.name,
        source_url=row.source_url,
        original_filename=row.original_filename,
        s3_key=row.s3_key,
        extracted_chars=row.extracted_chars,
        exemplar=row.exemplar,
        status=row.status,  # type: ignore[arg-type]
        added_at=row.added_at,
    )


def _from_row(row: VoiceProfileRow) -> VoiceProfile:
    return VoiceProfile(
        id=str(row.id),
        user_id=str(row.user_id),
        name=row.name,
        persona_identity=row.persona_identity,
        persona_one_line=row.persona_one_line,
        persona_tone=row.persona_tone,
        rules=VoiceRules.model_validate(row.rules or {}),
        distilled_style_md=row.distilled_style_md,
        distilled_at=row.distilled_at,
        version=row.version,
        samples=[_sample_from_row(s) for s in row.samples],
    )


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class SqlVoiceStore:
    """Per-user, async voice-profile store."""

    async def get(self, user_id: UUID) -> VoiceProfile | None:
        """Load the user's voice profile (with samples), or None if absent."""
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id)
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            await session.refresh(row, ["samples"])
            return _from_row(row)

    async def get_or_create(self, user_id: UUID) -> VoiceProfile:
        """Return the existing profile, or insert a blank one and return it."""
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id)
                )
            ).scalar_one_or_none()
            if row is None:
                row = VoiceProfileRow(user_id=user_id)
                session.add(row)
                await session.commit()
            await session.refresh(row, ["samples"])
            return _from_row(row)

    async def update_persona(
        self,
        user_id: UUID,
        *,
        identity: str,
        one_line: str,
        tone: str,
    ) -> VoiceProfile:
        """Update the persona fields and bump version."""
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id)
                )
            ).scalar_one_or_none()
            if row is None:
                row = VoiceProfileRow(user_id=user_id)
                session.add(row)
            row.persona_identity = identity
            row.persona_one_line = one_line
            row.persona_tone = tone
            row.version += 1
            row.updated_at = _now()
            await session.commit()
            await session.refresh(row, ["samples"])
            return _from_row(row)

    async def update_rules(self, user_id: UUID, rules: VoiceRules) -> VoiceProfile:
        """Persist rules as JSON and bump version."""
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id)
                )
            ).scalar_one_or_none()
            if row is None:
                row = VoiceProfileRow(user_id=user_id)
                session.add(row)
            row.rules = rules.model_dump()
            row.version += 1
            row.updated_at = _now()
            await session.commit()
            await session.refresh(row, ["samples"])
            return _from_row(row)

    async def set_distilled(self, user_id: UUID, distilled_style_md: str) -> VoiceProfile:
        """Persist the distilled style markdown and bump version."""
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id)
                )
            ).scalar_one_or_none()
            if row is None:
                row = VoiceProfileRow(user_id=user_id)
                session.add(row)
            row.distilled_style_md = distilled_style_md
            row.distilled_at = _now()
            row.version += 1
            row.updated_at = _now()
            await session.commit()
            await session.refresh(row, ["samples"])
            return _from_row(row)

    async def add_sample(
        self,
        user_id: UUID,
        *,
        kind: str,
        name: str,
        s3_key: str,
        extracted_chars: int = 0,
        source_url: str | None = None,
        original_filename: str | None = None,
        exemplar: bool = False,
        status: str = "ready",
    ) -> VoiceSample:
        """Insert a sample on the user's profile; bump profile version."""
        async with get_sessionmaker()() as session:
            # Ensure profile exists
            row = (
                await session.execute(
                    select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id)
                )
            ).scalar_one_or_none()
            if row is None:
                row = VoiceProfileRow(user_id=user_id)
                session.add(row)
                await session.flush()

            sample_row = VoiceSampleRow(
                profile_id=row.id,
                kind=kind,
                name=name,
                s3_key=s3_key,
                extracted_chars=extracted_chars,
                source_url=source_url,
                original_filename=original_filename,
                exemplar=exemplar,
                status=status,
            )
            session.add(sample_row)

            row.version += 1
            row.updated_at = _now()

            await session.commit()
            await session.refresh(sample_row)
            return _sample_from_row(sample_row)

    async def delete_sample(self, user_id: UUID, sample_id: str) -> None:
        """Delete a sample belonging to the user's profile; bump version."""
        try:
            sample_uuid = UUID(sample_id)
        except ValueError:
            return
        async with get_sessionmaker()() as session:
            # Load profile to scope by user
            row = (
                await session.execute(
                    select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id)
                )
            ).scalar_one_or_none()
            if row is None:
                return
            sample_row = (
                await session.execute(
                    select(VoiceSampleRow).where(
                        VoiceSampleRow.id == sample_uuid,
                        VoiceSampleRow.profile_id == row.id,
                    )
                )
            ).scalar_one_or_none()
            if sample_row is None:
                return
            await session.delete(sample_row)
            row.version += 1
            row.updated_at = _now()
            await session.commit()

    async def set_exemplar(
        self, user_id: UUID, sample_id: str, exemplar: bool
    ) -> VoiceProfile:
        """Toggle a sample's exemplar flag; bump version only on a real change.

        Lenient like delete_sample: an unparseable or foreign sample id is a
        no-op that returns the caller's current profile (never None, never a
        version bump)."""
        try:
            sample_uuid = UUID(sample_id)
        except ValueError:
            return await self.get_or_create(user_id)
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(VoiceProfileRow).where(VoiceProfileRow.user_id == user_id)
                )
            ).scalar_one_or_none()
            if row is None:
                # No profile to toggle against; create a blank one so the caller
                # still gets a valid profile back.
                row = VoiceProfileRow(user_id=user_id)
                session.add(row)
                await session.commit()
                await session.refresh(row, ["samples"])
                return _from_row(row)
            sample_row = (
                await session.execute(
                    select(VoiceSampleRow).where(
                        VoiceSampleRow.id == sample_uuid,
                        VoiceSampleRow.profile_id == row.id,
                    )
                )
            ).scalar_one_or_none()
            if sample_row is not None:
                sample_row.exemplar = exemplar
                row.version += 1
                row.updated_at = _now()
                await session.commit()
            await session.refresh(row, ["samples"])
            return _from_row(row)
