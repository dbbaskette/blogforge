from __future__ import annotations

from typing import ClassVar

import pytest

from blogforge.publishing.github_client import (
    GitHubAtomicCommitResult,
    GitHubCommitResult,
    GitHubContent,
    GitHubFileWrite,
    GitHubIdentityAccess,
)
from tests.conftest import _seed_approved_user, _signed_client


class FakeGitHubClient:
    existing: GitHubContent | None = None
    put_calls: ClassVar[list[dict]] = []
    atomic_calls: ClassVar[list[dict]] = []

    def __init__(self, token: str) -> None:
        self.token = token

    async def get_identity(self) -> str:
        return "octocat"

    async def validate_destination(self, owner: str, repo: str, branch: str):
        return GitHubIdentityAccess(login="octocat", private=True, can_push=True)

    async def get_content(self, owner: str, repo: str, branch: str, path: str):
        return self.existing

    async def get_branch_head(self, owner: str, repo: str, branch: str) -> str:
        return "validated-head"

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
        self.put_calls.append({"path": path, "content": content, "expected_sha": expected_sha})
        n = len(self.put_calls)
        return GitHubCommitResult(
            content_sha=f"blob-{n}",
            content_url=f"https://github.test/blob/{n}",
            commit_sha=f"commit-{n}",
            commit_url=f"https://github.test/commit/{n}",
        )

    async def commit_files(
        self,
        owner: str,
        repo: str,
        branch: str,
        files: list[GitHubFileWrite],
        message: str,
        expected_head_sha: str,
    ) -> GitHubAtomicCommitResult:
        self.atomic_calls.append(
            {
                "files": files,
                "message": message,
                "expected_head_sha": expected_head_sha,
            }
        )
        return GitHubAtomicCommitResult(
            file_shas={file.path: f"atomic-{index}" for index, file in enumerate(files, 1)},
            commit_sha="atomic-commit",
            commit_url="https://github.test/commit/atomic-commit",
        )


class FakeBlobStore:
    fail: ClassVar[bool] = False

    async def get_object(self, key: str) -> bytes:
        if self.fail:
            raise OSError("blob unavailable")
        return b"\x89PNG route hero"


@pytest.fixture(autouse=True)
def _fake_github(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeGitHubClient.existing = None
    FakeGitHubClient.put_calls = []
    FakeGitHubClient.atomic_calls = []
    FakeBlobStore.fail = False
    monkeypatch.setattr("blogforge.api.publishing.GitHubPublisherClient", FakeGitHubClient)
    monkeypatch.setattr("blogforge.publishing.service.GitHubPublisherClient", FakeGitHubClient)
    monkeypatch.setattr("blogforge.publishing.service.get_s3_client", FakeBlobStore)


def _idea() -> dict:
    return {
        "topic": "A private repository post",
        "provider": "codex-cli",
        "model": "codex-default",
    }


def _configure(client) -> None:
    assert client.put("/api/publishing/token", json={"token": "good-token"}).status_code == 200
    assert (
        client.put(
            "/api/publishing/settings",
            json={
                "owner": "dbbaskette",
                "repo": "writing",
                "branch": "main",
                "content_dir": "content/posts",
                "frontmatter_preset": "hugo",
            },
        ).status_code
        == 200
    )


def test_publish_route_commits_and_records_draft(authed_client) -> None:
    client, _ = authed_client
    _configure(client)
    draft = client.post("/api/drafts", json=_idea()).json()

    response = client.post(f"/api/drafts/{draft['id']}/publish/github")

    assert response.status_code == 200
    body = response.json()
    assert body["path"] == "content/posts/a-private-repository-post.md"
    assert body["content_sha"] == "blob-1"
    assert body["commit_url"] == "https://github.test/commit/1"
    saved = client.get(f"/api/drafts/{draft['id']}").json()
    assert saved["published_path"] == body["path"]
    assert saved["published_sha"] == "blob-1"
    assert saved["published_owner"] == "dbbaskette"
    assert saved["published_repo"] == "writing"
    assert saved["published_branch"] == "main"


def test_republish_uses_same_path_and_latest_sha_after_title_change(authed_client) -> None:
    client, _ = authed_client
    _configure(client)
    draft = client.post("/api/drafts", json=_idea()).json()
    first = client.post(f"/api/drafts/{draft['id']}/publish/github").json()
    draft = client.get(f"/api/drafts/{draft['id']}").json()
    draft["title"] = "A completely different title"
    client.put(f"/api/drafts/{draft['id']}", json=draft)

    second = client.post(f"/api/drafts/{draft['id']}/publish/github")

    assert second.status_code == 200
    assert second.json()["path"] == first["path"]
    assert FakeGitHubClient.put_calls[1]["expected_sha"] == "blob-1"


def test_publish_route_records_atomically_published_hero(authed_client) -> None:
    client, _ = authed_client
    _configure(client)
    draft = client.post("/api/drafts", json=_idea()).json()
    draft["hero_image_key"] = "drafts/internal/generated.png"
    assert client.put(f"/api/drafts/{draft['id']}", json=draft).status_code == 200

    response = client.post(f"/api/drafts/{draft['id']}/publish/github")

    assert response.status_code == 200
    assert response.json()["content_sha"] == "atomic-1"
    assert len(FakeGitHubClient.atomic_calls) == 1
    saved = client.get(f"/api/drafts/{draft['id']}").json()
    assert saved["published_hero_path"] == ("content/posts/a-private-repository-post-hero.png")
    assert saved["published_hero_sha"] == "atomic-2"


def test_publish_route_returns_structured_error_when_hero_is_unavailable(
    authed_client,
) -> None:
    client, _ = authed_client
    _configure(client)
    draft = client.post("/api/drafts", json=_idea()).json()
    draft["hero_image_key"] = "drafts/internal/missing.png"
    assert client.put(f"/api/drafts/{draft['id']}", json=draft).status_code == 200
    FakeBlobStore.fail = True

    response = client.post(f"/api/drafts/{draft['id']}/publish/github")

    assert response.status_code == 503
    assert response.json()["detail"]["error"]["code"] == "hero_image_unavailable"
    assert not FakeGitHubClient.put_calls
    assert not FakeGitHubClient.atomic_calls


@pytest.mark.asyncio
async def test_publish_route_hides_cross_user_draft(authed_client) -> None:
    first, _ = authed_client
    draft = first.post("/api/drafts", json=_idea()).json()
    other_id = await _seed_approved_user(email="other-publisher@example.com")
    with _signed_client(other_id) as other:
        _configure(other)
        response = other.post(f"/api/drafts/{draft['id']}/publish/github")
    assert response.status_code == 404
    assert response.json()["detail"]["error"]["code"] == "draft_not_found"


def test_publish_route_reports_first_path_collision(authed_client) -> None:
    client, _ = authed_client
    _configure(client)
    draft = client.post("/api/drafts", json=_idea()).json()
    FakeGitHubClient.existing = GitHubContent(
        sha="existing", html_url="https://github.test/existing"
    )

    response = client.post(f"/api/drafts/{draft['id']}/publish/github")

    assert response.status_code == 409
    error = response.json()["detail"]["error"]
    assert error["code"] == "publish_path_exists"
    assert error["repository_url"] == "https://github.com/dbbaskette/writing"
    assert error["path"] == "content/posts/a-private-repository-post.md"
    assert client.get(f"/api/drafts/{draft['id']}").json()["published_path"] is None
