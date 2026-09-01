"""POST /api/drafts/{id}/hero-image request contract."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

import blogforge.api.hero as hero_api
from blogforge.drafts.models import Draft, IdeaInput


class _Store:
    def __init__(self, draft: Draft) -> None:
        self.draft = draft

    async def get(self, draft_id: str, *, user_id: str) -> Draft | None:
        return self.draft if draft_id == self.draft.id else None

    async def update(self, draft_id: str, draft: Draft, *, user_id: str) -> Draft:
        self.draft = draft
        return draft


class _Vault:
    async def get(self, provider: str) -> str:
        return "google-key" if provider == "google" else ""


class _S3:
    async def put_object(self, key: str, data: bytes, mime: str) -> None:
        return None

    async def delete_object(self, key: str) -> None:
        return None


@pytest.mark.asyncio
async def test_generate_hero_forwards_theme_and_direction_to_grounded_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    draft = Draft(
        id="draft-1",
        title="Offline field work",
        idea=IdeaInput(topic="Offline field work", provider="anthropic", model="m"),
    )
    store = _Store(draft)
    seen: dict[str, str] = {}

    async def fake_build_provider(user_id: str, provider: str) -> object:
        return object()

    async def fake_build_prompt(
        draft: Draft,
        provider: object,
        model: str,
        *,
        theme: str,
        direction: str,
    ) -> str:
        seen["theme"] = theme
        seen["direction"] = direction
        return "grounded space prompt"

    async def fake_generate(prompt: str, api_key: str) -> tuple[bytes, str]:
        seen["prompt"] = prompt
        return b"image", "image/png"

    monkeypatch.setattr(hero_api, "KeyVault", lambda user_id: _Vault())
    monkeypatch.setattr(hero_api, "build_provider_for", fake_build_provider)
    monkeypatch.setattr(hero_api, "build_hero_prompt_ai", fake_build_prompt)
    monkeypatch.setattr(hero_api, "generate_hero_image", fake_generate)
    monkeypatch.setattr(hero_api, "get_s3_client", lambda: _S3())

    body = hero_api._HeroBody(
        theme="space",
        direction="Retro-futurist cobalt and coral illustration",
    )
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(draft_store=store)))
    result = await hero_api.generate_hero(
        draft.id,
        body,
        request,
        SimpleNamespace(id="user-1"),
    )

    assert seen == {
        "theme": "space",
        "direction": "Retro-futurist cobalt and coral illustration",
        "prompt": "grounded space prompt",
    }
    assert result["hero_image_key"].startswith("drafts/draft-1/hero/")
    assert store.draft.hero_image_key == result["hero_image_key"]
