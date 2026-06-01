"""AI hero-image generation via Google Imagen (Gemini Developer API, REST).

The text Google provider already talks to generativelanguage.googleapis.com
directly over httpx (the deprecated google-generativeai SDK has no Imagen
support), so hero images use the same REST style — the Imagen `:predict`
endpoint. Image generation is Google-only here regardless of the draft's text
provider, per the product decision to reuse the existing Google key.

NOTE: Imagen on the Gemini API requires a paid-tier key; a free key returns
403, surfaced as a clean ProviderError to the caller.
"""
from __future__ import annotations

import base64

import httpx

from blogforge.drafts.models import Draft
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey, ProviderRateLimit

_BASE = "https://generativelanguage.googleapis.com/v1beta"
# Override at the call site if needed; Imagen 3 is the current hero-quality model.
DEFAULT_IMAGE_MODEL = "imagen-3.0-generate-002"


def build_hero_prompt(draft: Draft) -> str:
    """Derive a default image prompt from the draft's subject."""
    topic = draft.title or draft.idea.topic
    return (
        f'A striking, editorial hero image for a blog post titled "{topic}". '
        "Conceptual and tasteful, evocative of the theme, cinematic lighting, "
        "no text, letters, or words anywhere in the image. Wide 16:9 banner composition."
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
