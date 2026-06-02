"""Headline & hook lab — generate alternative titles or opening hooks.

A small, focused generator: given a draft's topic + outline, produce N distinct
title or opening-hook options in the author's voice, so the author can pick the
sharpest one instead of living with the first attempt. Uses structured JSON
output (one provider.complete call) so we get a clean list.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.llm.base import LLMProvider

HeadlineKind = Literal["title", "hook"]

_OPTIONS_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["options"],
}

_KIND_DIRECTIVE: dict[str, str] = {
    "title": (
        "Generate {n} distinct alternative TITLES for this post. Each should be a "
        "different angle (curiosity, benefit, contrarian, specific-number, etc.) — "
        "not minor rewordings of one idea. Punchy, concrete, no clickbait, no "
        "trailing punctuation."
    ),
    "hook": (
        "Generate {n} distinct alternative OPENING HOOKS (one sentence or two each) "
        "for this post. Each should open the piece a different way (a scene, a "
        "provocation, a surprising fact, a direct question). Make the reader want "
        "to keep going."
    ),
}


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


def _context(draft: Draft) -> str:
    parts = [f"Topic: {draft.title or draft.idea.topic}"]
    if draft.outline:
        if draft.outline.opening_hook.strip():
            parts.append(f"Current hook: {draft.outline.opening_hook.strip()}")
        if draft.outline.sections:
            parts.append("Outline:")
            parts.extend(
                f"- {s.title}" + (f": {s.brief}" if s.brief else "") for s in draft.outline.sections
            )
    if draft.idea.notes.strip():
        parts.append(f"Notes: {draft.idea.notes.strip()}")
    return "\n".join(parts)


def _build_prompt(draft: Draft, kind: HeadlineKind, n: int) -> str:
    directive = _KIND_DIRECTIVE[kind].format(n=n)
    return (
        f"{directive}\n\n"
        "Ground every option in the post described below — do not invent a "
        "different topic. Stay in the author's voice; banished words/phrases never "
        'appear. Return JSON: {"options": ["...", "..."]}.\n\n'
        f"{_context(draft)}"
    )


async def generate_headlines(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    kind: HeadlineKind,
    n: int = 5,
) -> list[str]:
    """Return up to ``n`` title or hook options for the draft, in voice."""
    from myvoice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=3)
    system = compose_prompt(
        pack_root,
        format=draft.idea.format,
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    user = _build_prompt(draft, kind, n)
    full_prompt = f"{system}\n\n---\n\n{user}"
    resp = await provider.complete(model=model, prompt=full_prompt, json_schema=_OPTIONS_SCHEMA)
    try:
        data = json.loads(resp.text)
    except json.JSONDecodeError:
        return []
    options = data.get("options", []) if isinstance(data, dict) else []
    return [str(o).strip() for o in options if str(o).strip()][:n]
