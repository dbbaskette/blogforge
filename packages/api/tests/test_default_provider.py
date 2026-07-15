"""A user's preferred writing provider is validated and persisted."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from blogforge.auth.passwords import hash_password
from blogforge.auth.sessions import COOKIE_NAME, SessionSigner
from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import User
from blogforge.server import create_app

TEXT_PROVIDERS = (
    "anthropic",
    "openai",
    "google",
    "claude-cli",
    "codex-cli",
    "tanzu",
)


async def _create_user(email: str) -> User:
    async with get_sessionmaker()() as session:
        user = User(
            email=email,
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


def _client_for(user: User) -> TestClient:
    client = TestClient(create_app())
    client.cookies.set(
        COOKIE_NAME,
        SessionSigner("test-session-secret").sign(user.id),
    )
    return client


async def _default_for(user: User) -> str | None:
    async with get_sessionmaker()() as session:
        row = await session.scalar(select(User).where(User.id == user.id))
        assert row is not None
        return row.default_provider


@pytest.mark.parametrize("provider", TEXT_PROVIDERS)
async def test_put_persists_each_supported_default_provider(provider: str):
    user = await _create_user(f"{provider}@example.com")

    with _client_for(user) as client:
        response = client.put(
            "/api/providers/default",
            json={"default_provider": provider},
        )

        assert response.status_code == 200
        assert response.json() == {"default_provider": provider}
        assert client.get("/api/providers/default").json() == {
            "default_provider": provider
        }
        assert await _default_for(user) == provider


async def test_default_provider_starts_null(authed_client):
    client, _ = authed_client

    response = client.get("/api/providers/default")

    assert response.status_code == 200
    assert response.json() == {"default_provider": None}


async def test_put_rejects_unknown_provider(authed_client):
    client, user_id = authed_client

    response = client.put(
        "/api/providers/default",
        json={"default_provider": "bogus"},
    )

    assert response.status_code == 422
    async with get_sessionmaker()() as session:
        user = await session.get(User, user_id)
        assert user is not None
        assert user.default_provider is None


async def test_put_accepts_provider_even_when_runtime_is_unavailable(
    authed_client, monkeypatch
):
    client, _ = authed_client
    monkeypatch.setattr("blogforge.llm.codex_cli.codex_available", lambda: False)

    availability = client.get("/api/providers")
    response = client.put(
        "/api/providers/default",
        json={"default_provider": "codex-cli"},
    )

    assert availability.json()["codex-cli"] is False
    assert response.status_code == 200
    assert response.json() == {"default_provider": "codex-cli"}


async def test_default_provider_is_isolated_between_users():
    alice = await _create_user("alice-default@example.com")
    bob = await _create_user("bob-default@example.com")

    with _client_for(alice) as alice_client, _client_for(bob) as bob_client:
        assert alice_client.put(
            "/api/providers/default",
            json={"default_provider": "anthropic"},
        ).status_code == 200
        assert bob_client.put(
            "/api/providers/default",
            json={"default_provider": "google"},
        ).status_code == 200

        assert alice_client.get("/api/providers/default").json() == {
            "default_provider": "anthropic"
        }
        assert bob_client.get("/api/providers/default").json() == {
            "default_provider": "google"
        }
