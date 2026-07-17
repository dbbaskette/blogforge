from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest

from blogforge.drafts.models import Draft, IdeaInput, Section
from blogforge.export.render import to_markdown
from blogforge.publishing.github_client import (
    GitHubCommitResult,
    GitHubContent,
    GitHubIdentityAccess,
    PublishingError,
)
from blogforge.publishing.models import PublishingSettings
from blogforge.publishing.service import build_publish_path, publish_draft_to_github


def _draft(**updates) -> Draft:
    draft = Draft(
        title="Café Notes: A Better Day",
        stage="sections",
        idea=IdeaInput(
            topic="Original topic",
            provider="codex-cli",
            model="codex-default",
        ),
        sections=[
            Section(
                id="intro",
                title="Intro",
                content_md="The finished article.",
                status="ready",
                word_count=3,
            )
        ],
    )
    return draft.model_copy(update=updates)


class FakeDraftStore:
    def __init__(self, draft: Draft | None) -> None:
        self.draft = draft
        self.record_calls: list[dict] = []

    async def get(self, draft_id: str, *, user_id):
        return self.draft if self.draft and self.draft.id == draft_id else None

    async def record_publication(self, draft_id: str, *, user_id, **metadata):
        self.record_calls.append(metadata)
        assert self.draft is not None
        self.draft = self.draft.model_copy(update=metadata)
        return self.draft


class FakeSettingsStore:
    def __init__(self, settings: PublishingSettings | None) -> None:
        self.settings = settings

    async def get(self, user_id):
        return self.settings


class FakeVault:
    def __init__(self, token: str) -> None:
        self.token = token

    async def get(self) -> str:
        return self.token


class FakeGitHub:
    def __init__(self) -> None:
        self.existing: GitHubContent | None = None
        self.put_calls: list[dict] = []
        self.raise_on_put: PublishingError | None = None

    async def validate_destination(self, owner: str, repo: str, branch: str):
        return GitHubIdentityAccess(login="octocat", private=True, can_push=True)

    async def get_content(self, owner: str, repo: str, branch: str, path: str):
        return self.existing

    async def put_content(
        self,
        owner: str,
        repo: str,
        branch: str,
        path: str,
        content: str,
        message: str,
        expected_sha: str | None,
    ) -> GitHubCommitResult:
        self.put_calls.append(
            {
                "owner": owner,
                "repo": repo,
                "branch": branch,
                "path": path,
                "content": content,
                "message": message,
                "expected_sha": expected_sha,
            }
        )
        if self.raise_on_put:
            raise self.raise_on_put
        number = len(self.put_calls)
        return GitHubCommitResult(
            content_sha=f"blob-{number}",
            content_url=f"https://github.test/blob/{number}",
            commit_sha=f"commit-{number}",
            commit_url=f"https://github.test/commit/{number}",
        )


def _settings(preset="hugo") -> PublishingSettings:
    return PublishingSettings(
        owner="dbbaskette",
        repo="writing",
        branch="main",
        content_dir="content/posts",
        frontmatter_preset=preset,
    )


@pytest.mark.parametrize(
    ("preset", "expected"),
    [
        ("hugo", "content/posts/cafe-notes-a-better-day.md"),
        ("plain", "content/posts/cafe-notes-a-better-day.md"),
        ("jekyll", "content/posts/2026-07-17-cafe-notes-a-better-day.md"),
    ],
)
def test_build_publish_path_uses_preset_filename(preset: str, expected: str) -> None:
    assert build_publish_path(_settings(preset), _draft(), date(2026, 7, 17)) == expected


def test_build_publish_path_rejects_title_without_slug_characters() -> None:
    with pytest.raises(PublishingError) as caught:
        build_publish_path(_settings(), _draft(title="🎉"), date(2026, 7, 17))

    assert caught.value.code == "publish_title_invalid"
    assert caught.value.status_code == 400


@pytest.mark.asyncio
async def test_first_publish_creates_markdown_and_records_metadata() -> None:
    user_id = uuid4()
    draft = _draft()
    store = FakeDraftStore(draft)
    github = FakeGitHub()
    published_at = datetime(2026, 7, 17, 12, tzinfo=UTC)

    result = await publish_draft_to_github(
        draft.id,
        user_id,
        store,
        settings_store=FakeSettingsStore(_settings()),
        token_vault=FakeVault("secret"),
        github=github,
        now=lambda: published_at,
    )

    call = github.put_calls[0]
    assert call["expected_sha"] is None
    assert call["content"] == to_markdown(draft, frontmatter=True)
    assert call["message"] == "Publish: Café Notes: A Better Day"
    assert result.path == "content/posts/cafe-notes-a-better-day.md"
    assert result.content_sha == "blob-1"
    assert store.record_calls == [
        {
            "published_at": published_at,
            "published_path": result.path,
            "published_sha": "blob-1",
            "published_commit_url": "https://github.test/commit/1",
            "published_owner": "dbbaskette",
            "published_repo": "writing",
            "published_branch": "main",
        }
    ]


@pytest.mark.asyncio
async def test_plain_preset_matches_markdown_without_frontmatter() -> None:
    user_id = uuid4()
    draft = _draft()
    github = FakeGitHub()
    await publish_draft_to_github(
        draft.id,
        user_id,
        FakeDraftStore(draft),
        settings_store=FakeSettingsStore(_settings("plain")),
        token_vault=FakeVault("secret"),
        github=github,
    )
    assert github.put_calls[0]["content"] == to_markdown(draft, frontmatter=False)


@pytest.mark.asyncio
async def test_title_change_updates_original_path_with_stored_sha() -> None:
    user_id = uuid4()
    original = _draft(
        published_path="content/posts/original-title.md",
        published_sha="old-blob",
        published_owner="dbbaskette",
        published_repo="writing",
        published_branch="main",
    )
    renamed = original.model_copy(update={"title": "A completely different title"})
    store = FakeDraftStore(renamed)
    github = FakeGitHub()

    result = await publish_draft_to_github(
        renamed.id,
        user_id,
        store,
        settings_store=FakeSettingsStore(_settings()),
        token_vault=FakeVault("secret"),
        github=github,
    )

    assert result.path == "content/posts/original-title.md"
    assert github.put_calls[0]["path"] == result.path
    assert github.put_calls[0]["expected_sha"] == "old-blob"
    assert github.put_calls[0]["message"] == "Update: A completely different title"


@pytest.mark.asyncio
async def test_first_publish_stops_when_path_already_exists() -> None:
    user_id = uuid4()
    draft = _draft()
    store = FakeDraftStore(draft)
    github = FakeGitHub()
    github.existing = GitHubContent(sha="someone-elses", html_url="https://github.test/file")

    with pytest.raises(PublishingError, match="already exists") as caught:
        await publish_draft_to_github(
            draft.id,
            user_id,
            store,
            settings_store=FakeSettingsStore(_settings()),
            token_vault=FakeVault("secret"),
            github=github,
        )
    assert caught.value.code == "publish_path_exists"
    assert caught.value.repository_url == "https://github.com/dbbaskette/writing"
    assert caught.value.path == "content/posts/cafe-notes-a-better-day.md"
    assert not github.put_calls
    assert not store.record_calls


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure",
    [
        PublishingError("publish_conflict", "The file changed.", 409),
        PublishingError("github_unavailable", "GitHub is unavailable.", 503),
    ],
)
async def test_failed_write_does_not_change_publication_metadata(failure) -> None:
    user_id = uuid4()
    draft = _draft(
        published_path="content/posts/post.md",
        published_sha="old",
        published_owner="dbbaskette",
        published_repo="writing",
        published_branch="main",
    )
    store = FakeDraftStore(draft)
    github = FakeGitHub()
    github.raise_on_put = failure

    with pytest.raises(PublishingError) as caught:
        await publish_draft_to_github(
            draft.id,
            user_id,
            store,
            settings_store=FakeSettingsStore(_settings()),
            token_vault=FakeVault("secret"),
            github=github,
        )
    assert caught.value.code == failure.code
    assert not store.record_calls
    assert store.draft.published_sha == "old"


@pytest.mark.asyncio
async def test_republish_rejects_a_changed_destination_before_github_write() -> None:
    draft = _draft(
        published_path="content/posts/post.md",
        published_sha="old",
        published_owner="dbbaskette",
        published_repo="original-repo",
        published_branch="main",
    )
    store = FakeDraftStore(draft)
    github = FakeGitHub()

    with pytest.raises(PublishingError) as caught:
        await publish_draft_to_github(
            draft.id,
            uuid4(),
            store,
            settings_store=FakeSettingsStore(_settings()),
            token_vault=FakeVault("secret"),
            github=github,
        )

    assert caught.value.code == "publish_destination_changed"
    assert caught.value.status_code == 409
    assert caught.value.repository_url == "https://github.com/dbbaskette/original-repo"
    assert caught.value.path == "content/posts/post.md"
    assert not github.put_calls


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("draft", "settings", "token", "code", "status"),
    [
        (None, _settings(), "secret", "draft_not_found", 404),
        (_draft(), None, "secret", "github_settings_missing", 400),
        (_draft(), _settings(), "", "github_token_missing", 400),
    ],
)
async def test_publish_requires_owned_draft_configuration_and_token(
    draft, settings, token, code, status
) -> None:
    draft_id = draft.id if draft else str(uuid4())
    with pytest.raises(PublishingError) as caught:
        await publish_draft_to_github(
            draft_id,
            uuid4(),
            FakeDraftStore(draft),
            settings_store=FakeSettingsStore(settings),
            token_vault=FakeVault(token),
            github=FakeGitHub(),
        )
    assert caught.value.code == code
    assert caught.value.status_code == status
