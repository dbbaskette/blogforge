"""Topic sparks — brainstorm blog post ideas *before* a draft exists.

The compose page's blank-page problem: a writer opens "Just write it" and stares
at an empty Topic box. This generates N distinct post ideas (title + one-line
angle) in the author's voice, optionally riffing on a seed the writer typed, so
they can pick one and start. Unlike ``headlines`` this needs no Draft — it runs
straight off a materialized pack root, so it works from the compose screen.
"""
# ruff: noqa: E501

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from blogforge.llm.base import LLMProvider
from blogforge.prompt_rules import OUTPUT_RATIONALE, PromptRule, render_prompt_rules

_TOPICS_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "angle": {"type": "string"},
                },
                "required": ["title"],
            },
        },
    },
    "required": ["topics"],
}


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


def _build_prompt(seed: str, n: int) -> str:
    seed = seed.strip()
    theme = (
        f"The writer is circling this theme — riff on it, sharpen it, and offer "
        f"angles they might not have considered:\n{seed}\n\n"
        if seed
        else "The writer hasn't settled on a theme yet — propose a spread of ideas "
        "that suit this voice and the kinds of things this author writes about.\n\n"
    )
    rules = render_prompt_rules(
        [
            PromptRule(
                "Make each idea a genuinely different direction rather than a reworded version of one idea.",
                "A useful brainstorm gives the writer distinct paths to choose from.",
            ),
            PromptRule(
                "Vary the ideas across approaches such as a how-to, contrarian take, personal story, myth-buster, or trend read.",
                "A mix of editorial shapes helps the writer find an angle that fits the subject.",
            ),
            PromptRule(
                "Give each idea a punchy, concrete title.",
                "The writer needs to recognize the post's promise at a glance.",
            ),
            PromptRule(
                "Do not use clickbait in titles.",
                "Misleading titles weaken reader trust.",
            ),
            PromptRule(
                "Do not use trailing punctuation in titles.",
                "Trailing punctuation makes titles look cluttered in publishing surfaces.",
            ),
            PromptRule(
                "Give each idea a one-line angle describing what the post would argue or reveal.",
                "A concise angle distinguishes an idea from a title alone.",
            ),
            PromptRule(
                "Use the author's voice.", "The ideas should suit what this author actually writes."
            ),
            PromptRule(
                "Do not use banished words or phrases.",
                "Those terms conflict with the author's established voice and explicit preferences.",
            ),
            PromptRule("Return JSON matching the topics schema.", OUTPUT_RATIONALE),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "topic titles or angles.",
                "Those labels are prompt metadata rather than article prose.",
            ),
        ]
    )
    return (
        f"Brainstorm {n} blog post ideas. {theme}{rules}\n\n"
        'Topics schema: {"topics": [{"title": "...", "angle": "..."}]}.'
    )


def parse_topics(raw: str, n: int) -> list[dict[str, str]]:
    """Parse the model's JSON reply into a clean, capped list of topic dicts.

    Tolerant of junk: bad JSON → ``[]``; entries without a title are dropped;
    ``angle`` defaults to ``""``. Kept separate from the network call so it can
    be unit-tested without a provider.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("topics", []) if isinstance(data, dict) else []
    out: list[dict[str, str]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title", "")).strip()
        if not title:
            continue
        out.append({"title": title, "angle": str(it.get("angle", "")).strip()})
    return out[:n]


async def generate_topics(
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    seed: str = "",
    n: int = 5,
) -> list[dict[str, str]]:
    """Return up to ``n`` ``{title, angle}`` post ideas in the pack's voice."""
    from blogforge.voice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=3)
    system = compose_prompt(
        pack_root,
        format=None,
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    full_prompt = f"{system}\n\n---\n\n{_build_prompt(seed, n)}"
    resp = await provider.complete(model=model, prompt=full_prompt, json_schema=_TOPICS_SCHEMA)
    return parse_topics(resp.text, n)
