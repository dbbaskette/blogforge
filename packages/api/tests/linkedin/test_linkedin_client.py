"""LinkedInClient: create_post + social_actions over httpx, respx-mocked."""
import httpx
import pytest
import respx

from pencraft.linkedin.client import LinkedInClient, LinkedInError


def _client() -> LinkedInClient:
    return LinkedInClient(access_token="AQ-tok", api_base="https://api.linkedin.com", api_version="202401")


@respx.mock
async def test_create_post_returns_urn_from_header():
    route = respx.post("https://api.linkedin.com/rest/posts").mock(
        return_value=httpx.Response(201, headers={"x-restli-id": "urn:li:share:777"})
    )
    urn = await _client().create_post(
        author_urn="urn:li:person:abc", commentary="hello", visibility="PUBLIC"
    )
    assert urn == "urn:li:share:777"
    # versioned header present
    sent = route.calls.last.request
    assert sent.headers["LinkedIn-Version"] == "202401"
    assert sent.headers["Authorization"] == "Bearer AQ-tok"


@respx.mock
async def test_create_post_401_raises_stale():
    respx.post("https://api.linkedin.com/rest/posts").mock(
        return_value=httpx.Response(401, json={"message": "expired"})
    )
    with pytest.raises(LinkedInError) as ei:
        await _client().create_post(author_urn="urn:li:person:a", commentary="x")
    assert ei.value.stale_token is True


@respx.mock
async def test_create_post_other_error_raises_non_stale():
    respx.post("https://api.linkedin.com/rest/posts").mock(
        return_value=httpx.Response(500, json={"message": "boom"})
    )
    with pytest.raises(LinkedInError) as ei:
        await _client().create_post(author_urn="urn:li:person:a", commentary="x")
    assert ei.value.stale_token is False


@respx.mock
async def test_social_actions_parsed():
    urn = "urn:li:share:777"
    respx.get(f"https://api.linkedin.com/v2/socialActions/{urn}").mock(
        return_value=httpx.Response(
            200,
            json={
                "likesSummary": {"totalLikes": 12},
                "commentsSummary": {"totalComments": 4},
            },
        )
    )
    stats = await _client().social_actions(urn)
    assert stats == {"likes": 12, "comments": 4}


@respx.mock
async def test_social_actions_missing_fields_default_zero():
    urn = "urn:li:share:888"
    respx.get(f"https://api.linkedin.com/v2/socialActions/{urn}").mock(
        return_value=httpx.Response(200, json={})
    )
    assert await _client().social_actions(urn) == {"likes": 0, "comments": 0}
