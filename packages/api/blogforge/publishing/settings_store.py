"""SQL persistence for a user's single GitHub publishing destination."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import UserPublishingSettings
from blogforge.publishing.models import PublishingSettings


def normalize_content_dir(raw: str) -> str:
    parts = [part for part in raw.strip().strip("/").split("/") if part]
    if any(part in {".", ".."} for part in parts):
        raise ValueError("Content folder cannot contain . or .. segments.")
    return "/".join(parts)


def normalize_settings(settings: PublishingSettings) -> PublishingSettings:
    values = settings.model_dump()
    for field in ("owner", "repo", "branch"):
        values[field] = str(values[field]).strip()
        if not values[field]:
            raise ValueError(f"{field.replace('_', ' ').title()} must not be empty.")
    values["content_dir"] = normalize_content_dir(settings.content_dir)
    return PublishingSettings.model_validate(values)


class PublishingSettingsStore:
    async def get(self, user_id: UUID) -> PublishingSettings | None:
        async with get_sessionmaker()() as session:
            row = await session.scalar(
                select(UserPublishingSettings).where(UserPublishingSettings.user_id == user_id)
            )
        if row is None:
            return None
        return PublishingSettings(
            owner=row.owner,
            repo=row.repo,
            branch=row.branch,
            content_dir=row.content_dir,
            frontmatter_preset=row.frontmatter_preset,  # type: ignore[arg-type]
        )

    async def save(self, user_id: UUID, settings: PublishingSettings) -> PublishingSettings:
        cleaned = normalize_settings(settings)
        async with get_sessionmaker()() as session:
            row = await session.get(UserPublishingSettings, user_id)
            if row is None:
                row = UserPublishingSettings(user_id=user_id, **cleaned.model_dump())
                session.add(row)
            else:
                for field, value in cleaned.model_dump().items():
                    setattr(row, field, value)
            await session.commit()
        return cleaned
