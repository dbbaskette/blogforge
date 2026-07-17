"""Coordinate safe create/update commits for BlogForge drafts."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote
from uuid import UUID

from pydantic import BaseModel

from blogforge.drafts.models import Draft
from blogforge.export.render import to_markdown
from blogforge.publishing.github_client import (
    GitHubFileWrite,
    GitHubPublisherClient,
    PublishingError,
)
from blogforge.publishing.models import PublishingSettings
from blogforge.publishing.settings_store import PublishingSettingsStore
from blogforge.publishing.token_vault import PublishingTokenVault
from blogforge.s3 import S3Error, get_s3_client


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


def build_hero_path(post_path: str) -> str:
    """Place a stable PNG beside the published Markdown file."""
    post = PurePosixPath(post_path)
    return str(post.with_name(f"{post.stem}-hero.png"))


def _raise_path_exists(settings: PublishingSettings, path: str) -> None:
    raise PublishingError(
        "publish_path_exists",
        f"A GitHub file already exists at '{path}'.",
        409,
        repository_url=f"https://github.com/{settings.owner}/{settings.repo}",
        path=path,
    )


def _raise_publish_conflict(settings: PublishingSettings, path: str) -> None:
    raise PublishingError(
        "publish_conflict",
        "The GitHub file changed after BlogForge last published it.",
        409,
        repository_url=f"https://github.com/{settings.owner}/{settings.repo}",
        path=path,
    )


async def publish_draft_to_github(
    draft_id: str,
    user_id: UUID,
    store: Any,
    *,
    settings_store: Any | None = None,
    token_vault: Any | None = None,
    github: Any | None = None,
    blob_store: Any | None = None,
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

    hero_bytes: bytes | None = None
    if draft.hero_image_key:
        storage = blob_store or get_s3_client()
        try:
            hero_bytes = await storage.get_object(draft.hero_image_key)
        except (S3Error, OSError) as exc:
            raise PublishingError(
                "hero_image_unavailable",
                "The draft hero image could not be read. Regenerate it and try again.",
                503,
            ) from exc

    clock = now or (lambda: datetime.now(UTC))
    published_at = clock()
    is_update = draft.published_path is not None
    hero_path: str | None = None
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
                "This draft was published to a different repository or branch. "
                "Restore that destination in Settings before republishing.",
                409,
                repository_url=(
                    f"https://github.com/{draft.published_owner}/{draft.published_repo}"
                ),
                path=path,
            )
        expected_sha = draft.published_sha
        if bool(draft.published_hero_path) != bool(draft.published_hero_sha):
            raise PublishingError(
                "publish_state_invalid",
                "This draft is missing part of its published hero image revision.",
                409,
            )
        if hero_bytes is not None:
            hero_path = draft.published_hero_path or build_hero_path(path)
    else:
        path = build_publish_path(settings, draft, published_at.date())
        if hero_bytes is not None:
            hero_path = build_hero_path(path)

    client = github or GitHubPublisherClient(token)
    await client.validate_destination(settings.owner, settings.repo, settings.branch)

    if not is_update:
        existing = await client.get_content(settings.owner, settings.repo, settings.branch, path)
        if existing is not None:
            _raise_path_exists(settings, path)
        if hero_path is not None:
            existing_hero = await client.get_content(
                settings.owner, settings.repo, settings.branch, hero_path
            )
            if existing_hero is not None:
                _raise_path_exists(settings, hero_path)
        expected_sha = None
    elif hero_path is not None:
        existing_post = await client.get_content(
            settings.owner, settings.repo, settings.branch, path
        )
        if existing_post is None or existing_post.sha != expected_sha:
            _raise_publish_conflict(settings, path)
        if draft.published_hero_path:
            existing_hero = await client.get_content(
                settings.owner, settings.repo, settings.branch, hero_path
            )
            if existing_hero is None or existing_hero.sha != draft.published_hero_sha:
                _raise_publish_conflict(settings, hero_path)
        else:
            existing_hero = await client.get_content(
                settings.owner, settings.repo, settings.branch, hero_path
            )
            if existing_hero is not None:
                _raise_path_exists(settings, hero_path)

    hero_reference = PurePosixPath(hero_path).name if hero_path else None
    markdown = to_markdown(
        draft,
        frontmatter=settings.frontmatter_preset != "plain",
        hero_reference=hero_reference,
        include_hero_in_body=settings.frontmatter_preset == "plain",
    )
    title = draft.title or draft.idea.topic
    message = f"{'Update' if is_update else 'Publish'}: {title}"
    if hero_path is not None and hero_bytes is not None:
        atomic_result = await client.commit_files(
            settings.owner,
            settings.repo,
            settings.branch,
            [
                GitHubFileWrite(path=path, content=markdown.encode("utf-8")),
                GitHubFileWrite(path=hero_path, content=hero_bytes),
            ],
            message,
        )
        content_sha = atomic_result.file_shas[path]
        hero_sha = atomic_result.file_shas[hero_path]
        commit_sha = atomic_result.commit_sha
        commit_url = atomic_result.commit_url
        file_url = (
            f"https://github.com/{settings.owner}/{settings.repo}/blob/"
            f"{quote(settings.branch, safe='')}/{quote(path, safe='/')}"
        )
    else:
        result = await client.put_content(
            settings.owner,
            settings.repo,
            settings.branch,
            path,
            markdown,
            message,
            expected_sha,
        )
        content_sha = result.content_sha
        hero_sha = draft.published_hero_sha
        commit_sha = result.commit_sha
        commit_url = result.commit_url
        file_url = result.content_url

    recorded = await store.record_publication(
        draft_id,
        user_id=user_id,
        published_at=published_at,
        published_path=path,
        published_sha=content_sha,
        published_commit_url=commit_url,
        published_owner=settings.owner,
        published_repo=settings.repo,
        published_branch=settings.branch,
        published_hero_path=hero_path or draft.published_hero_path,
        published_hero_sha=hero_sha,
    )
    if recorded is None:
        raise PublishingError(
            "publish_record_failed",
            "GitHub accepted the commit, but BlogForge could not record it.",
            500,
        )
    return PublishResult(
        path=path,
        file_url=file_url,
        commit_url=commit_url,
        commit_sha=commit_sha,
        content_sha=content_sha,
        published_at=published_at,
    )
