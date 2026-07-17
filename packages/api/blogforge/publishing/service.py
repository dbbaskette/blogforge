"""Coordinate safe create/update commits for BlogForge drafts."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from blogforge.drafts.models import Draft
from blogforge.export.render import to_markdown
from blogforge.publishing.github_client import GitHubPublisherClient, PublishingError
from blogforge.publishing.models import PublishingSettings
from blogforge.publishing.settings_store import PublishingSettingsStore
from blogforge.publishing.token_vault import PublishingTokenVault


class PublishResult(BaseModel):
    path: str
    file_url: str
    commit_url: str
    commit_sha: str
    content_sha: str
    published_at: datetime


def slugify(title: str) -> str:
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^\da-z]+", "-", ascii_title.lower()).strip("-")
    slug = slug[:80].rstrip("-")
    return slug


def build_publish_path(settings: PublishingSettings, draft: Draft, today: date) -> str:
    slug = slugify(draft.title or draft.idea.topic)
    if not slug:
        raise PublishingError(
            "publish_title_invalid",
            "The draft title must contain at least one letter or number.",
            400,
        )
    filename = (
        f"{today.isoformat()}-{slug}.md"
        if settings.frontmatter_preset == "jekyll"
        else f"{slug}.md"
    )
    return f"{settings.content_dir}/{filename}" if settings.content_dir else filename


async def publish_draft_to_github(
    draft_id: str,
    user_id: UUID,
    store: Any,
    *,
    settings_store: Any | None = None,
    token_vault: Any | None = None,
    github: Any | None = None,
    now: Callable[[], datetime] | None = None,
) -> PublishResult:
    """Publish an owned draft and record metadata only after GitHub succeeds."""
    draft = await store.get(draft_id, user_id=user_id)
    if draft is None:
        raise PublishingError("draft_not_found", f"No draft '{draft_id}'", 404)

    destination_store = settings_store or PublishingSettingsStore()
    settings = await destination_store.get(user_id)
    if settings is None:
        raise PublishingError(
            "github_settings_missing",
            "Configure a GitHub publishing destination in Settings first.",
            400,
        )

    vault = token_vault or PublishingTokenVault(user_id)
    token = await vault.get()
    if not token:
        raise PublishingError(
            "github_token_missing",
            "Add a GitHub publishing token in Settings first.",
            400,
        )

    clock = now or (lambda: datetime.now(UTC))
    published_at = clock()
    is_update = draft.published_path is not None
    if is_update:
        path = draft.published_path
        if not all(
            (
                draft.published_sha,
                draft.published_owner,
                draft.published_repo,
                draft.published_branch,
            )
        ):
            raise PublishingError(
                "publish_state_invalid",
                "This draft is missing its original GitHub destination or content revision.",
                409,
            )
        same_destination = (
            draft.published_owner.lower() == settings.owner.lower()
            and draft.published_repo.lower() == settings.repo.lower()
            and draft.published_branch == settings.branch
        )
        if not same_destination:
            raise PublishingError(
                "publish_destination_changed",
                "This draft was published to a different repository or branch. Restore that destination in Settings before republishing.",
                409,
                repository_url=(
                    f"https://github.com/{draft.published_owner}/{draft.published_repo}"
                ),
                path=path,
            )
        expected_sha = draft.published_sha
    else:
        path = build_publish_path(settings, draft, published_at.date())

    client = github or GitHubPublisherClient(token)
    await client.validate_destination(settings.owner, settings.repo, settings.branch)

    if not is_update:
        existing = await client.get_content(settings.owner, settings.repo, settings.branch, path)
        if existing is not None:
            raise PublishingError(
                "publish_path_exists",
                f"A GitHub file already exists at '{path}'.",
                409,
                repository_url=f"https://github.com/{settings.owner}/{settings.repo}",
                path=path,
            )
        expected_sha = None

    markdown = to_markdown(draft, frontmatter=settings.frontmatter_preset != "plain")
    title = draft.title or draft.idea.topic
    result = await client.put_content(
        settings.owner,
        settings.repo,
        settings.branch,
        path,
        markdown,
        f"{'Update' if is_update else 'Publish'}: {title}",
        expected_sha,
    )

    recorded = await store.record_publication(
        draft_id,
        user_id=user_id,
        published_at=published_at,
        published_path=path,
        published_sha=result.content_sha,
        published_commit_url=result.commit_url,
        published_owner=settings.owner,
        published_repo=settings.repo,
        published_branch=settings.branch,
    )
    if recorded is None:
        raise PublishingError(
            "publish_record_failed",
            "GitHub accepted the commit, but BlogForge could not record it.",
            500,
        )
    return PublishResult(
        path=path,
        file_url=result.content_url,
        commit_url=result.commit_url,
        commit_sha=result.commit_sha,
        content_sha=result.content_sha,
        published_at=published_at,
    )
