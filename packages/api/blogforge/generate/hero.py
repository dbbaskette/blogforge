"""AI hero-image generation via the native Gemini image API."""
# ruff: noqa: E501

from __future__ import annotations

import base64
from typing import Literal

import httpx

from blogforge.drafts.models import Draft
from blogforge.llm.base import LLMProvider
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey, ProviderRateLimit
from blogforge.prompt_rules import PromptRule, render_prompt_rules

_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image"

HeroTheme = Literal["editorial", "fun", "space", "minimal"]

_THEME_DIRECTIONS: dict[HeroTheme, str] = {
    "editorial": (
        "Use a polished editorial visual style with restrained color and cinematic depth."
    ),
    "fun": (
        "Use a playful, energetic illustration style with bold color, expressive shapes, "
        "and a sense of delight."
    ),
    "space": (
        "Use an imaginative cosmic visual language with deep space, stars, and planetary "
        "forms while keeping the article-specific subject as the focal point."
    ),
    "minimal": (
        "Use a clean minimal composition with ample negative space, a limited palette, "
        "and one strong focal subject."
    ),
}


# Shared editorial rules appended to every hero prompt.
_HERO_STYLE = render_prompt_rules(
    [
        PromptRule(
            "Make the image conceptual, tasteful, and evocative of the theme with cinematic lighting.",
            "An editorial hero should convey the article's subject without looking like generic stock art.",
        ),
        PromptRule(
            "The image must contain no text, letters, words, or logos.",
            "Generated lettering is unreliable and can make the hero unusable.",
        ),
        PromptRule(
            "Use a wide 16:9 banner composition.",
            "The publishing layout crops hero images into a wide banner.",
        ),
        PromptRule(
            "Do not render the `Rule` or `Because` labels or their rationales in the image.",
            "Prompt metadata must not appear in the published hero image.",
        ),
    ]
)


def build_hero_prompt(
    draft: Draft,
    *,
    theme: HeroTheme = "editorial",
    direction: str = "",
) -> str:
    """Deterministic default from the draft's title. Also the fallback when the
    AI concept distill (:func:`build_hero_prompt_ai`) is unavailable."""
    topic = draft.title or draft.idea.topic
    context = _hero_context(draft, max_sections=2, max_section_chars=350)
    subject = (
        f'Create a scene for a blog post titled "{topic}" using only these article details:\n'
        f"{context}"
    )
    return _frame_hero_prompt(
        subject,
        theme=theme,
        direction=direction,
    )


def _frame_hero_prompt(
    subject: str,
    *,
    theme: HeroTheme = "editorial",
    direction: str = "",
) -> str:
    """Wrap a concrete subject description in the shared editorial styling."""
    custom = direction.strip()
    custom_rule = f" Creative direction from the writer: {custom}" if custom else ""
    return (
        f"A striking hero image. {subject.strip()} {_THEME_DIRECTIONS[theme]}"
        f"{custom_rule} {_HERO_STYLE}"
    )


def _hero_context(
    draft: Draft,
    *,
    max_sections: int = 6,
    max_section_chars: int = 700,
) -> str:
    """Compact, concrete material for the image concept — what the post is
    actually about: title, opening hook, section titles + briefs, and tags."""
    parts: list[str] = []
    title = draft.title or draft.idea.topic
    if title:
        parts.append(f"Title: {title}")
    if draft.outline and draft.outline.opening_hook:
        parts.append(f"Opening: {draft.outline.opening_hook}")
    seq = draft.sections or (draft.outline.sections if draft.outline else [])
    lines: list[str] = []
    for s in seq[:max_sections]:
        brief = (getattr(s, "brief", "") or "").strip()
        content = (getattr(s, "content_md", "") or "").strip()
        line = f"- {s.title}" + (f": {brief}" if brief else "")
        if content:
            line += f"\n  Article excerpt: {content[:max_section_chars]}"
        lines.append(line)
    if lines:
        parts.append("Sections:\n" + "\n".join(lines))
    if draft.tags:
        parts.append("Tags: " + ", ".join(draft.tags[:8]))
    return "\n".join(parts)


_HERO_DISTILL_INSTRUCTION = "You design blog cover art. From the post below, write a vivid prompt for an image generator to create its hero banner.\n\n"


_HERO_DISTILL_RULES = render_prompt_rules(
    [
        PromptRule(
            "Name a concrete subject, setting, and mood that capture what the post is actually about.",
            "Specific visual material gives the image generator a usable editorial concept.",
        ),
        PromptRule(
            "Use real objects or a scene rather than vague abstractions.",
            "Concrete imagery renders more reliably than an abstract theme alone.",
        ),
        PromptRule(
            "Use 2 to 4 specific visual anchors from the article when they are available, "
            "such as a number, named object, place, tool, or concrete comparison.",
            "Distinctive facts make the image specific to this post instead of generic stock art.",
        ),
        PromptRule(
            "Do not invent facts, objects, people, places, or numbers that are not supported "
            "by the supplied post.",
            "The hero concept must stay faithful to the article.",
        ),
        PromptRule(
            "Write one sentence under 40 words.",
            "A compact concept is easier to frame consistently as a hero image.",
        ),
        PromptRule(
            "Do not request text, letters, words, or logos in the image.",
            "Generated lettering is unreliable and can make the hero unusable.",
        ),
        PromptRule(
            "Output only the image prompt, without a preamble, quotes, or explanation.",
            "The returned text is passed directly into the image-generation prompt.",
        ),
        PromptRule(
            "Do not copy the `Rule` or `Because` labels or their rationales into the image prompt.",
            "Those labels are prompt metadata rather than image-description content.",
        ),
    ]
)


def _clean_concept(text: str) -> str:
    """Reduce the model's reply to a single clean concept line: drop code
    fences, keep the first non-empty line, strip wrapping quotes."""
    t = (text or "").strip().strip("`").strip()
    for line in t.splitlines():
        stripped = line.strip()
        if stripped:
            t = stripped
            break
    if len(t) >= 2 and t[0] in "\"'" and t[-1] == t[0]:
        t = t[1:-1].strip()
    return t[:400]


async def build_hero_prompt_ai(
    draft: Draft,
    provider: LLMProvider,
    model: str,
    *,
    theme: HeroTheme = "editorial",
    direction: str = "",
) -> str:
    """Distill the draft's content into a concrete image concept via the text
    model, then frame it in the editorial styling. Raises on provider failure —
    callers fall back to :func:`build_hero_prompt`."""
    resp = await provider.complete(
        model=model,
        prompt=f"{_HERO_DISTILL_INSTRUCTION}{_HERO_DISTILL_RULES}\n\nPOST:\n{_hero_context(draft)}",
    )
    concept = _clean_concept(resp.text)
    return (
        _frame_hero_prompt(concept, theme=theme, direction=direction)
        if concept
        else build_hero_prompt(draft, theme=theme, direction=direction)
    )


async def generate_hero_image(
    prompt: str,
    api_key: str,
    *,
    model: str = DEFAULT_IMAGE_MODEL,
    aspect_ratio: str = "16:9",
) -> tuple[bytes, str]:
    """Generate one image. Returns (image_bytes, mime_type)."""
    if not api_key:
        raise ProviderMissingKey("google")
    url = f"{_BASE}/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": aspect_ratio},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(url, json=payload)
    except httpx.TimeoutException as exc:
        raise ProviderError(
            "Google image generation timed out.",
            hint="Try again. The previous request may still have completed upstream.",
        )._with_code("provider_timeout") from exc
    except httpx.HTTPError as exc:
        raise ProviderError(
            "Could not reach Google image generation.",
            hint="Check the connection and try again.",
        )._with_code("provider_unavailable") from exc
    if r.status_code in (401, 403):
        raise ProviderMissingKey("google")
    if r.status_code == 429:
        raise ProviderRateLimit("Google image generation rate limit hit. Try again shortly.")
    if r.status_code >= 400:
        raise ProviderError(
            f"Google image generation returned HTTP {r.status_code}: {r.text[:300]}"
        )._with_code("image_generation_failed")
    try:
        data = r.json()
        candidates = data.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        inline = next((part.get("inlineData") for part in parts if part.get("inlineData")), None)
        if not inline or not inline.get("data"):
            raise ProviderError(
                "Google returned no image. The prompt may have been filtered.",
                hint="Adjust the image direction and try again.",
            )._with_code("image_generation_filtered")
        mime = str(inline.get("mimeType") or "image/png")
        return base64.b64decode(inline["data"], validate=True), mime
    except ProviderError:
        raise
    except (ValueError, TypeError, KeyError) as exc:
        raise ProviderError("Google returned an invalid image response.")._with_code(
            "image_generation_invalid_response"
        ) from exc
