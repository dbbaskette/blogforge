"""AI hero-image generation via Google Imagen (Gemini Developer API, REST).

The text Google provider already talks to generativelanguage.googleapis.com
directly over httpx (the deprecated google-generativeai SDK has no Imagen
support), so hero images use the same REST style — the Imagen `:predict`
endpoint. Image generation is Google-only here regardless of the draft's text
provider, per the product decision to reuse the existing Google key.

NOTE: Imagen on the Gemini API requires a paid-tier key; a free key returns
403, surfaced as a clean ProviderError to the caller.
"""
# ruff: noqa: E501

from __future__ import annotations

import base64

import httpx

from blogforge.drafts.models import Draft
from blogforge.llm.base import LLMProvider
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey, ProviderRateLimit
from blogforge.prompt_rules import PromptRule, render_prompt_rules

_BASE = "https://generativelanguage.googleapis.com/v1beta"
# Imagen 4 via the :predict endpoint — verified available on the Gemini API
# (imagen-3.0-* 404s on v1beta). Use -fast-generate-001 for a cheaper/quicker
# variant. Override at the call site if a key exposes different models.
DEFAULT_IMAGE_MODEL = "imagen-4.0-generate-001"


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
    ]
)


def build_hero_prompt(draft: Draft) -> str:
    """Deterministic default from the draft's title. Also the fallback when the
    AI concept distill (:func:`build_hero_prompt_ai`) is unavailable."""
    topic = draft.title or draft.idea.topic
    return f'A striking, editorial hero image for a blog post titled "{topic}". {_HERO_STYLE}'


def _frame_hero_prompt(subject: str) -> str:
    """Wrap a concrete subject description in the shared editorial styling."""
    return f"A striking, editorial hero image. {subject.strip()} {_HERO_STYLE}"


def _hero_context(draft: Draft, *, max_sections: int = 6) -> str:
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
        lines.append(f"- {s.title}" + (f": {brief}" if brief else ""))
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
            "Do not copy the `Rule` or `Because` labels into the image prompt.",
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


async def build_hero_prompt_ai(draft: Draft, provider: LLMProvider, model: str) -> str:
    """Distill the draft's content into a concrete image concept via the text
    model, then frame it in the editorial styling. Raises on provider failure —
    callers fall back to :func:`build_hero_prompt`."""
    resp = await provider.complete(
        model=model,
        prompt=f"{_HERO_DISTILL_INSTRUCTION}{_HERO_DISTILL_RULES}\n\nPOST:\n{_hero_context(draft)}",
    )
    concept = _clean_concept(resp.text)
    return _frame_hero_prompt(concept) if concept else build_hero_prompt(draft)


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
    url = f"{_BASE}/models/{model}:predict?key={api_key}"
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1, "aspectRatio": aspect_ratio},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(url, json=payload)
    if r.status_code in (401, 403):
        raise ProviderMissingKey("google")
    if r.status_code == 429:
        raise ProviderRateLimit("Imagen rate limit hit — try again shortly.")
    if r.status_code >= 400:
        raise ProviderError(f"imagen {r.status_code}: {r.text[:300]}")
    data = r.json()
    predictions = data.get("predictions") or []
    if not predictions:
        raise ProviderError("Imagen returned no image (the prompt may have been filtered).")
    pred = predictions[0]
    b64 = pred.get("bytesBase64Encoded")
    mime = str(pred.get("mimeType") or "image/png")
    if not b64:
        raise ProviderError("Imagen response missing image bytes.")
    return base64.b64decode(b64), mime
