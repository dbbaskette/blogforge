import base64
import json

import httpx
import pytest
import respx

from blogforge.publishing.github_client import (
    GitHubFileWrite,
    GitHubPublisherClient,
    PublishingError,
)

API = "https://api.github.com"


@respx.mock
async def test_validate_destination_returns_login_and_private_repo_access() -> None:
    respx.get(f"{API}/user").mock(return_value=httpx.Response(200, json={"login": "dan"}))
    respx.get(f"{API}/repos/dan/private-blog").mock(
        return_value=httpx.Response(
            200,
            json={"private": True, "permissions": {"push": True}},
        )
    )
    respx.get(f"{API}/repos/dan/private-blog/branches/main").mock(
        return_value=httpx.Response(200, json={"name": "main"})
    )

    access = await GitHubPublisherClient("github_pat_secret").validate_destination(
        "dan", "private-blog", "main"
    )

    assert access.login == "dan"
    assert access.private is True
    assert access.can_push is True


@respx.mock
async def test_validate_destination_rejects_missing_push_permission() -> None:
    respx.get(f"{API}/user").mock(return_value=httpx.Response(200, json={"login": "dan"}))
    respx.get(f"{API}/repos/dan/blog").mock(
        return_value=httpx.Response(200, json={"private": False, "permissions": {"push": False}})
    )

    with pytest.raises(PublishingError) as caught:
        await GitHubPublisherClient("token").validate_destination("dan", "blog", "main")
    assert caught.value.code == "github_write_forbidden"
    assert caught.value.status_code == 403


@respx.mock
async def test_missing_content_returns_none() -> None:
    respx.get(f"{API}/repos/dan/blog/contents/posts/a.md?ref=main").mock(
        return_value=httpx.Response(404, json={"message": "Not Found"})
    )
    assert (
        await GitHubPublisherClient("token").get_content("dan", "blog", "main", "posts/a.md")
        is None
    )


@respx.mock
async def test_create_encodes_markdown_without_sha() -> None:
    route = respx.put(f"{API}/repos/dan/blog/contents/posts/a.md").mock(
        return_value=httpx.Response(
            201,
            json={
                "content": {
                    "sha": "blob-one",
                    "html_url": "https://github.com/dan/blog/blob/main/posts/a.md",
                },
                "commit": {
                    "sha": "commit-one",
                    "html_url": "https://github.com/dan/blog/commit/commit-one",
                },
            },
        )
    )

    result = await GitHubPublisherClient("token").put_content(
        "dan", "blog", "main", "posts/a.md", "# A", "Publish: A", None
    )

    payload = json.loads(route.calls.last.request.content)
    assert base64.b64decode(payload["content"]).decode() == "# A"
    assert "sha" not in payload
    assert result.content_sha == "blob-one"
    assert result.commit_sha == "commit-one"


@respx.mock
async def test_update_sends_expected_sha() -> None:
    route = respx.put(f"{API}/repos/dan/blog/contents/posts/a.md").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": {
                    "sha": "new-blob",
                    "html_url": "https://github.com/dan/blog/blob/main/posts/a.md",
                },
                "commit": {
                    "sha": "commit-sha",
                    "html_url": "https://github.com/dan/blog/commit/commit-sha",
                },
            },
        )
    )

    result = await GitHubPublisherClient("token").put_content(
        "dan", "blog", "main", "posts/a.md", "# A", "Update: A", "old-blob"
    )
    payload = json.loads(route.calls.last.request.content)
    assert payload["sha"] == "old-blob"
    assert result.content_sha == "new-blob"


@respx.mock
async def test_commit_files_creates_one_commit_with_both_blobs() -> None:
    respx.get(f"{API}/repos/dan/blog/git/commits/old-head").mock(
        return_value=httpx.Response(200, json={"tree": {"sha": "base-tree"}})
    )
    blob_route = respx.post(f"{API}/repos/dan/blog/git/blobs").mock(
        side_effect=[
            httpx.Response(201, json={"sha": "markdown-blob"}),
            httpx.Response(201, json={"sha": "image-blob"}),
        ]
    )
    tree_route = respx.post(f"{API}/repos/dan/blog/git/trees").mock(
        return_value=httpx.Response(201, json={"sha": "new-tree"})
    )
    commit_route = respx.post(f"{API}/repos/dan/blog/git/commits").mock(
        return_value=httpx.Response(201, json={"sha": "new-commit"})
    )
    ref_route = respx.patch(f"{API}/repos/dan/blog/git/refs/heads/main").mock(
        return_value=httpx.Response(200, json={"object": {"sha": "new-commit"}})
    )

    result = await GitHubPublisherClient("token").commit_files(
        "dan",
        "blog",
        "main",
        [
            GitHubFileWrite("posts/a.md", b"# A"),
            GitHubFileWrite("posts/a-hero.png", b"\x89PNG"),
        ],
        "Publish: A",
        "old-head",
    )

    assert result.file_shas == {
        "posts/a.md": "markdown-blob",
        "posts/a-hero.png": "image-blob",
    }
    assert result.commit_sha == "new-commit"
    assert result.commit_url == "https://github.com/dan/blog/commit/new-commit"
    blob_payloads = [json.loads(call.request.content) for call in blob_route.calls]
    assert base64.b64decode(blob_payloads[0]["content"]) == b"# A"
    assert base64.b64decode(blob_payloads[1]["content"]) == b"\x89PNG"
    assert json.loads(tree_route.calls.last.request.content) == {
        "base_tree": "base-tree",
        "tree": [
            {"path": "posts/a.md", "mode": "100644", "type": "blob", "sha": "markdown-blob"},
            {
                "path": "posts/a-hero.png",
                "mode": "100644",
                "type": "blob",
                "sha": "image-blob",
            },
        ],
    }
    assert json.loads(commit_route.calls.last.request.content) == {
        "message": "Publish: A",
        "tree": "new-tree",
        "parents": ["old-head"],
    }
    assert json.loads(ref_route.calls.last.request.content) == {
        "sha": "new-commit",
        "force": False,
    }


@respx.mock
async def test_commit_files_maps_branch_race_to_publish_conflict() -> None:
    respx.get(f"{API}/repos/dan/blog/git/commits/old-head").mock(
        return_value=httpx.Response(200, json={"tree": {"sha": "base-tree"}})
    )
    respx.post(f"{API}/repos/dan/blog/git/blobs").mock(
        return_value=httpx.Response(201, json={"sha": "markdown-blob"})
    )
    respx.post(f"{API}/repos/dan/blog/git/trees").mock(
        return_value=httpx.Response(201, json={"sha": "new-tree"})
    )
    respx.post(f"{API}/repos/dan/blog/git/commits").mock(
        return_value=httpx.Response(201, json={"sha": "new-commit"})
    )
    respx.patch(f"{API}/repos/dan/blog/git/refs/heads/main").mock(
        return_value=httpx.Response(422, json={"message": "Reference update failed"})
    )

    with pytest.raises(PublishingError) as caught:
        await GitHubPublisherClient("token").commit_files(
            "dan",
            "blog",
            "main",
            [GitHubFileWrite("posts/a.md", b"# A")],
            "Update: A",
            "old-head",
        )

    assert caught.value.code == "publish_conflict"
    assert caught.value.repository_url == "https://github.com/dan/blog"
    assert caught.value.path == "posts/a.md"


@respx.mock
async def test_get_branch_head_returns_immutable_validation_ref() -> None:
    respx.get(f"{API}/repos/dan/blog/git/ref/heads/feature%2Fposts").mock(
        return_value=httpx.Response(200, json={"object": {"sha": "validated-head"}})
    )

    result = await GitHubPublisherClient("token").get_branch_head("dan", "blog", "feature/posts")

    assert result == "validated-head"


@respx.mock
async def test_stale_sha_maps_to_publish_conflict() -> None:
    respx.put(f"{API}/repos/dan/blog/contents/posts/a.md").mock(
        return_value=httpx.Response(409, json={"message": "sha does not match"})
    )
    with pytest.raises(PublishingError) as caught:
        await GitHubPublisherClient("token").put_content(
            "dan", "blog", "main", "posts/a.md", "# A", "Update: A", "old"
        )
    assert caught.value.code == "publish_conflict"
    assert caught.value.repository_url == "https://github.com/dan/blog"
    assert caught.value.path == "posts/a.md"
    assert "token" not in str(caught.value)


@respx.mock
async def test_rate_limit_maps_retry_after() -> None:
    respx.get(f"{API}/user").mock(
        return_value=httpx.Response(
            403,
            headers={"X-RateLimit-Remaining": "0", "Retry-After": "30"},
            json={"message": "rate limit"},
        )
    )
    with pytest.raises(PublishingError) as caught:
        await GitHubPublisherClient("token").get_identity()
    assert caught.value.code == "github_rate_limited"
    assert caught.value.status_code == 429
    assert caught.value.retry_after == 30


@respx.mock
async def test_secondary_rate_limit_with_retry_after_is_not_misclassified() -> None:
    respx.get(f"{API}/user").mock(
        return_value=httpx.Response(
            403,
            headers={"Retry-After": "60", "X-RateLimit-Remaining": "42"},
            json={"message": "You have exceeded a secondary rate limit."},
        )
    )
    with pytest.raises(PublishingError) as caught:
        await GitHubPublisherClient("token").get_identity()
    assert caught.value.code == "github_rate_limited"
    assert caught.value.status_code == 429
    assert caught.value.retry_after == 60


@respx.mock
async def test_headerless_secondary_rate_limit_message_is_not_misclassified() -> None:
    respx.get(f"{API}/user").mock(
        return_value=httpx.Response(
            403,
            json={"message": "You have exceeded a secondary rate limit."},
        )
    )
    with pytest.raises(PublishingError) as caught:
        await GitHubPublisherClient("token").get_identity()
    assert caught.value.code == "github_rate_limited"
    assert caught.value.status_code == 429
    assert caught.value.retry_after == 60


async def test_timeout_maps_to_unavailable() -> None:
    def timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    client = GitHubPublisherClient("token", transport=httpx.MockTransport(timeout))
    with pytest.raises(PublishingError) as caught:
        await client.get_identity()
    assert caught.value.code == "github_unavailable"
    assert "slow" not in str(caught.value)


@respx.mock
async def test_malformed_success_response_maps_to_unavailable() -> None:
    respx.get(f"{API}/user").mock(return_value=httpx.Response(200, content=b"not-json"))

    with pytest.raises(PublishingError) as caught:
        await GitHubPublisherClient("token").get_identity()

    assert caught.value.code == "github_unavailable"
    assert caught.value.status_code == 502


@respx.mock
async def test_success_response_missing_commit_shape_maps_to_unavailable() -> None:
    respx.put(f"{API}/repos/dan/blog/contents/posts/a.md").mock(
        return_value=httpx.Response(201, json={"content": {"sha": "blob"}})
    )

    with pytest.raises(PublishingError) as caught:
        await GitHubPublisherClient("token").put_content(
            "dan", "blog", "main", "posts/a.md", "# A", "Publish: A", None
        )

    assert caught.value.code == "github_unavailable"
