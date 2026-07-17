import base64
import json

import httpx
import pytest
import respx

from blogforge.publishing.github_client import GitHubPublisherClient, PublishingError

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
