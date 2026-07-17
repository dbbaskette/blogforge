from __future__ import annotations

from dataclasses import dataclass

import pytest

from blogforge.publishing.github_client import PublishingError
from tests.conftest import _seed_approved_user, _signed_client


@dataclass(frozen=True)
class _Access:
    login: str
    private: bool = True
    can_push: bool = True


class FakeGitHubClient:
    identity = "octocat"

    def __init__(self, token: str) -> None:
        self.token = token

    async def get_identity(self) -> str:
        if self.token == "bad-token":
            raise PublishingError(
                "github_token_invalid", "GitHub rejected the publishing token.", 400
            )
        return self.identity

    async def validate_destination(self, owner: str, repo: str, branch: str) -> _Access:
        if repo == "missing":
            raise PublishingError(
                "github_repo_not_found",
                "GitHub repository was not found or is not accessible.",
                404,
            )
        if branch == "missing":
            raise PublishingError("github_branch_not_found", "Branch 'missing' was not found.", 404)
        if repo == "readonly":
            raise PublishingError(
                "github_write_forbidden",
                "The GitHub token cannot write to this repository.",
                403,
            )
        return _Access(login=self.identity)


@pytest.fixture(autouse=True)
def _fake_github(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("blogforge.api.publishing.GitHubPublisherClient", FakeGitHubClient)


def _destination(**overrides: str) -> dict[str, str]:
    body = {
        "owner": " dbbaskette ",
        "repo": " writing ",
        "branch": " main ",
        "content_dir": " /content//posts/ ",
        "frontmatter_preset": "hugo",
    }
    body.update(overrides)
    return body


def test_settings_are_normalized_and_never_return_token(authed_client) -> None:
    client, _ = authed_client
    token_response = client.put("/api/publishing/token", json={"token": "github_pat_secret"})
    assert token_response.status_code == 200
    assert token_response.json() == {"token_set": True, "login": "octocat"}

    response = client.put("/api/publishing/settings", json=_destination())
    assert response.status_code == 200
    body = client.get("/api/publishing/settings").json()
    assert body == {
        "configured": True,
        "owner": "dbbaskette",
        "repo": "writing",
        "branch": "main",
        "content_dir": "content/posts",
        "frontmatter_preset": "hugo",
        "token_set": True,
        "validated_login": None,
        "ready": False,
    }
    assert "token" not in body
    assert "github_pat_secret" not in str(body)


@pytest.mark.asyncio
async def test_settings_and_token_are_user_scoped(authed_client) -> None:
    first, _ = authed_client
    assert first.put("/api/publishing/token", json={"token": "first-token"}).status_code == 200
    assert first.put("/api/publishing/settings", json=_destination()).status_code == 200

    second_id = await _seed_approved_user(email="publisher-two@example.com")
    with _signed_client(second_id) as second:
        body = second.get("/api/publishing/settings").json()
        assert body["configured"] is False
        assert body["token_set"] is False


@pytest.mark.parametrize("content_dir", ["../posts", "posts/./drafts", "posts/../../etc"])
def test_settings_reject_path_traversal(authed_client, content_dir: str) -> None:
    client, _ = authed_client
    response = client.put("/api/publishing/settings", json=_destination(content_dir=content_dir))
    assert response.status_code == 400
    assert response.json()["detail"]["error"]["code"] == "invalid_content_dir"


def test_settings_reject_invalid_preset(authed_client) -> None:
    client, _ = authed_client
    response = client.put(
        "/api/publishing/settings", json=_destination(frontmatter_preset="wordpress")
    )
    assert response.status_code == 422


def test_clear_token_preserves_destination(authed_client) -> None:
    client, _ = authed_client
    client.put("/api/publishing/settings", json=_destination())
    client.put("/api/publishing/token", json={"token": "github_pat_secret"})

    response = client.delete("/api/publishing/token")
    assert response.status_code == 204
    body = client.get("/api/publishing/settings").json()
    assert body["configured"] is True
    assert body["token_set"] is False


def test_validate_returns_authenticated_login_and_ready(authed_client) -> None:
    client, _ = authed_client
    client.put("/api/publishing/settings", json=_destination())
    client.put("/api/publishing/token", json={"token": "github_pat_secret"})

    response = client.post("/api/publishing/validate")
    assert response.status_code == 200
    assert response.json() == {
        "ready": True,
        "validated_login": "octocat",
        "private": True,
    }


def test_validate_requires_token(authed_client) -> None:
    client, _ = authed_client
    client.put("/api/publishing/settings", json=_destination())
    response = client.post("/api/publishing/validate")
    assert response.status_code == 400
    assert response.json()["detail"]["error"]["code"] == "github_token_missing"


def test_invalid_token_is_not_stored(authed_client) -> None:
    client, _ = authed_client
    response = client.put("/api/publishing/token", json={"token": "bad-token"})
    assert response.status_code == 400
    assert response.json()["detail"]["error"]["code"] == "github_token_invalid"
    assert client.get("/api/publishing/settings").json()["token_set"] is False


@pytest.mark.parametrize(
    ("repo", "branch", "code", "status"),
    [
        ("missing", "main", "github_repo_not_found", 404),
        ("writing", "missing", "github_branch_not_found", 404),
        ("readonly", "main", "github_write_forbidden", 403),
    ],
)
def test_validate_reports_destination_errors(
    authed_client, repo: str, branch: str, code: str, status: int
) -> None:
    client, _ = authed_client
    client.put("/api/publishing/settings", json=_destination(repo=repo, branch=branch))
    client.put("/api/publishing/token", json={"token": "github_pat_secret"})
    response = client.post("/api/publishing/validate")
    assert response.status_code == status
    assert response.json()["detail"]["error"]["code"] == code
