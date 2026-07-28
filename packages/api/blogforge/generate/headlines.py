"""Headline & hook lab — generate alternative titles or opening hooks.

A small, focused generator: given a draft's topic + outline, produce N distinct
title or opening-hook options in the author's voice, so the author can pick the
sharpest one instead of living with the first attempt. Uses structured JSON
output (one provider.complete call) so we get a clean list.
"""
# ruff: noqa: E501

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.generate.formats import resolve_format
from blogforge.llm.base import LLMProvider
from blogforge.prompt_rules import OUTPUT_RATIONALE, PromptRule, render_prompt_rules

HeadlineKind = Literal["title", "hook"]

_OPTIONS_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["options"],
}

_KIND_DIRECTIVE: dict[str, str] = {
    "title": ("Generate {n} alternative TITLES for this post."),
    "hook": ("Generate {n} alternative OPENING HOOKS for this post."),
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
    kind_rules = (
        [
            PromptRule(
                "Make every title a distinct angle rather than a minor rewording.",
                "Distinct options help the author choose a genuinely different framing.",
            ),
            PromptRule(
                "Explore different title angles such as curiosity, benefit, contrarian, or a specific number.",
                "Varied approaches make the headline options useful alternatives instead of a single idea repeated.",
            ),
            PromptRule(
                "Make each title punchy and concrete.",
                "Readers need to understand the article's value at a glance.",
            ),
            PromptRule(
                "Do not use clickbait in titles.",
                "Misleading titles weaken reader trust.",
            ),
            PromptRule(
                "Do not use trailing punctuation in titles.",
                "Trailing punctuation makes titles look cluttered in publishing surfaces.",
            ),
        ]
        if kind == "title"
        else [
            PromptRule(
                "Make every hook a distinct opening approach rather than a minor rewording.",
                "Different openings let the author choose the strongest way into the article.",
            ),
            PromptRule(
                "Vary the hooks with approaches such as a scene, provocation, surprising fact, or direct question.",
                "Different opening shapes create meaningful choices for the article's first impression.",
            ),
            PromptRule(
                "Keep each hook to one or two sentences.",
                "An opening hook needs to establish momentum before the article begins.",
            ),
            PromptRule(
                "Make each hook invite the reader to continue.",
                "The hook's job is to earn attention for the article that follows.",
            ),
        ]
    )
    rules = render_prompt_rules(
        [
            *kind_rules,
            PromptRule(
                "Ground every headline option in this post.",
                "A headline for a different topic misrepresents the article.",
            ),
            PromptRule(
                "Use the author's voice.",
                "The options should sound like the author, not a generic headline generator.",
            ),
            PromptRule(
                "Do not use banished words or phrases.",
                "Those terms conflict with the author's established voice and explicit preferences.",
            ),
            PromptRule(
                "Return JSON matching the options schema.",
                OUTPUT_RATIONALE,
            ),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels into options.",
                "Those labels are prompt metadata rather than article prose.",
            ),
        ]
    )
    return (
        f"{directive}\n\n"
        f"{rules}\n\n"
        'Options schema: {"options": ["...", "..."]}.\n\n'
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
    from blogforge.voice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=3)
    system = compose_prompt(
        pack_root,
        format=resolve_format(pack_root, draft.idea.format),
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
