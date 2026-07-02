"""Hero image: Imagen REST call (mocked) + export embedding."""
from __future__ import annotations

import base64

import httpx
import pytest
import respx

from blogforge.drafts.models import Draft, IdeaInput, OutlineProposal, OutlineSection, Section
from blogforge.export.render import frontmatter_block, to_html
from blogforge.generate.hero import (
    _BASE,
    DEFAULT_IMAGE_MODEL,
    _clean_concept,
    _hero_context,
    build_hero_prompt,
    build_hero_prompt_ai,
    generate_hero_image,
)
from blogforge.llm.base import LLMResponse
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey

_PREDICT = f"{_BASE}/models/{DEFAULT_IMAGE_MODEL}:predict"


def _draft() -> Draft:
    return Draft(
        title="Why local-first wins",
        idea=IdeaInput(topic="local-first", pack_slug="dan", provider="anthropic", model="m"),
        sections=[Section(id="s1", title="Intro", content_md="Body.", status="ready")],
    )


def test_build_hero_prompt_uses_title_and_forbids_text() -> None:
    p = build_hero_prompt(_draft())
    assert "Why local-first wins" in p
    assert "no text" in p.lower()


def _rich_draft() -> Draft:
    return Draft(
        title="Why local-first wins",
        idea=IdeaInput(topic="local-first", pack_slug="dan", provider="anthropic", model="m"),
        outline=OutlineProposal(
            opening_hook="Your data should live on your device, not a server farm.",
            sections=[
                OutlineSection(
                    id="s1", title="Offline-first sync", brief="CRDTs, conflict-free merges"
                ),
                OutlineSection(
                    id="s2", title="Owning your data", brief="local SQLite, no cloud lock-in"
                ),
            ],
        ),
        tags=["local-first", "sync", "CRDT"],
    )


def test_hero_context_pulls_concrete_content_not_just_title() -> None:
    ctx = _hero_context(_rich_draft())
    assert "Why local-first wins" in ctx
    assert "Your data should live on your device" in ctx  # opening hook
    assert "Offline-first sync" in ctx and "Owning your data" in ctx  # section titles
    assert "CRDT" in ctx  # tags/briefs


def test_clean_concept_strips_quotes_fences_and_preamble() -> None:
    assert _clean_concept('"A glowing laptop on a desk"') == "A glowing laptop on a desk"
    assert _clean_concept("```\nA lone server rack\n```") == "A lone server rack"
    assert (
        _clean_concept("Sure! Here is the prompt.\nA misty mountain") == "Sure! Here is the prompt."
    )


class _FakeTextProvider:
    """Captures the prompt and returns a canned concept."""

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.seen_prompt = ""

    async def complete(self, *, model: str, prompt: str, json_schema=None) -> LLMResponse:
        self.seen_prompt = prompt
        return LLMResponse(
            text=self.reply, input_tokens=0, output_tokens=0, model=model, finish_reason="stop"
        )


@pytest.mark.asyncio
async def test_build_hero_prompt_ai_frames_model_concept_from_content() -> None:
    prov = _FakeTextProvider("A weathered sailor steering a small boat through fog")
    out = await build_hero_prompt_ai(_rich_draft(), prov, "m")
    # The distilled concept is framed with the shared editorial styling.
    assert "A weathered sailor steering a small boat through fog" in out
    assert "no text" in out.lower()
    # The model actually saw the article's content, not just the title.
    assert "Offline-first sync" in prov.seen_prompt
    assert "Your data should live on your device" in prov.seen_prompt


@pytest.mark.asyncio
async def test_build_hero_prompt_ai_falls_back_when_model_returns_nothing() -> None:
    out = await build_hero_prompt_ai(_rich_draft(), _FakeTextProvider("   "), "m")
    # Empty concept → deterministic title-based fallback.
    assert out == build_hero_prompt(_rich_draft())


@respx.mock
@pytest.mark.asyncio
async def test_generate_hero_image_decodes_bytes() -> None:
    png = b"\x89PNG-fake-bytes"
    route = respx.post(url__startswith=_PREDICT).mock(
        return_value=httpx.Response(
            200,
            json={
                "predictions": [
                    {"bytesBase64Encoded": base64.b64encode(png).decode(), "mimeType": "image/png"}
                ]
            },
        )
    )
    out, mime = await generate_hero_image("a prompt", "sk-key")
    assert out == png
    assert mime == "image/png"
    assert route.called


@respx.mock
@pytest.mark.asyncio
async def test_generate_hero_image_403_is_missing_key() -> None:
    respx.post(url__startswith=_PREDICT).mock(return_value=httpx.Response(403, text="forbidden"))
    with pytest.raises(ProviderMissingKey):
        await generate_hero_image("p", "sk-key")


@respx.mock
@pytest.mark.asyncio
async def test_generate_hero_image_empty_predictions_errors() -> None:
    respx.post(url__startswith=_PREDICT).mock(return_value=httpx.Response(200, json={"predictions": []}))
    with pytest.raises(ProviderError):
        await generate_hero_image("p", "sk-key")


def test_frontmatter_includes_image_when_hero_set() -> None:
    draft = _draft()
    assert "image:" not in frontmatter_block(draft)
    draft.hero_image_key = "drafts/x/hero/abc.png"
    fm = frontmatter_block(draft)
    assert "image:" in fm and "abc.png" in fm


def test_to_html_embeds_hero_data_uri() -> None:
    html = to_html(_draft(), hero_data_uri="data:image/png;base64,AAAA")
    assert 'class="hero"' in html
    assert "data:image/png;base64,AAAA" in html
    # Without a hero, no figure is emitted.
    assert 'class="hero"' not in to_html(_draft())
