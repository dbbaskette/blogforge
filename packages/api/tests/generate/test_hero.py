"""Hero image: Imagen REST call (mocked) + export embedding."""
from __future__ import annotations

import base64

import httpx
import pytest
import respx

from blogforge.drafts.models import Draft, IdeaInput, Section
from blogforge.export.render import frontmatter_block, to_html
from blogforge.generate.hero import (
    _BASE,
    DEFAULT_IMAGE_MODEL,
    build_hero_prompt,
    generate_hero_image,
)
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
