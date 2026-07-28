"""Shape Assistant — proactive, voice-aware suggestions for a whole draft.

Runs one focused, JSON-schema'd pass per suggestion kind (parallelizable) and
returns a punch-list the writer can act on:

- ``fact_check``  — claims *worth verifying*. The model cannot check truth, only
  flag what a careful editor would double-check, and say why. Never asserts a
  claim is true or false. ``options`` is always empty.
- ``reword``      — sentences that could be sharper, each with 2-3 in-voice
  alternatives in ``options`` (dash-cleaned so no em dashes slip through).
- ``expand``      — thin spots that would land harder with a concrete example,
  number, or counterpoint; ``options`` holds specific things to add.
"""
# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.llm.base import LLMProvider
from blogforge.prompt_rules import (
    OUTPUT_RATIONALE,
    PRESERVATION_RATIONALE,
    TTS_RATIONALE,
    PromptRule,
    render_prompt_rules,
)
from blogforge.voice.enforce import deterministic_backstop

SuggestKind = Literal["fact_check", "reword", "expand"]
ALL_KINDS: tuple[SuggestKind, ...] = ("fact_check", "reword", "expand")

_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "note": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["target", "note"],
            },
        },
    },
    "required": ["suggestions"],
}

_DIRECTIVE: dict[SuggestKind, str] = {
    "fact_check": "Identify up to {n} specific factual claims that a careful editor would double-check before publishing.",
    "reword": "Find up to {n} sentences or phrases that could be sharper.",
    "expand": "Find up to {n} spots that would land harder with more substance.",
}

_KIND_RULES: dict[SuggestKind, tuple[PromptRule, ...]] = {
    "fact_check": (
        PromptRule(
            "Consider statistics, dates, names, 'studies show' assertions, superlatives, and strong causal claims.",
            "These claim types are especially likely to need evidence before publication.",
        ),
        PromptRule(
            "Copy each target claim verbatim and explain briefly in `note` why it deserves verification.",
            "The writer needs to locate and assess the exact claim efficiently.",
        ),
        PromptRule(
            "Do not assert whether a claim is true or false; flag only what to check.",
            "This assistant has the draft, not the evidence needed to verify factual truth.",
        ),
        PromptRule(
            "Leave `options` empty for fact-check findings.",
            "Fact-checking should surface verification work, not invent a replacement claim.",
        ),
        PromptRule(
            "Return an empty list if no claims need verification.",
            "Invented findings would create unnecessary editorial work.",
        ),
    ),
    "reword": (
        PromptRule(
            "Look for wording that is wordy, vague, clichéd, passive, or hedgy.",
            "These issues can make otherwise useful prose less clear and direct.",
        ),
        PromptRule(
            "Copy each target verbatim and name its problem briefly in `note`.",
            "The writer needs to locate the edit and understand why it was suggested.",
        ),
        PromptRule(
            "Give two or three alternative phrasings in `options`.",
            "Multiple choices let the writer retain editorial control over the wording.",
        ),
        PromptRule("Preserve the target's meaning and the author's voice.", PRESERVATION_RATIONALE),
        PromptRule(
            "Do not use banished words or phrases.",
            "These terms conflict with the author's established voice and explicit preferences.",
        ),
        PromptRule(
            "Do not use em dashes.",
            TTS_RATIONALE,
        ),
    ),
    "expand": (
        PromptRule(
            "Look for spots that need a concrete example, number, counterpoint, or consequence.",
            "Specific substance helps the writer strengthen a thin part of the draft.",
        ),
        PromptRule(
            "Copy each target location verbatim and describe what is thin in `note`.",
            "The writer needs to place the addition in the intended passage.",
        ),
        PromptRule(
            "Give one or two specific things the author could add in `options`.",
            "Concrete suggestions make the next editorial step actionable.",
        ),
        PromptRule(
            "Do not write the addition itself.",
            "This workflow offers editorial direction while leaving the prose to the author.",
        ),
    ),
}


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


def _draft_text(draft: Draft) -> str:
    parts = [f"# {draft.title or draft.idea.topic}"]
    for s in draft.sections:
        body = s.content_md.strip()
        parts.append(f"## {s.title}\n\n{body}" if body else f"## {s.title}")
    return "\n\n".join(parts)


def parse_suggestions(raw: str, n: int) -> list[dict[str, Any]]:
    """Parse a kind's JSON reply into clean ``{target, note, options}`` dicts.

    Tolerant: bad JSON → ``[]``; entries without a ``target`` are dropped;
    ``options`` is coerced to a list of non-empty strings. Capped at ``n``.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("suggestions", []) if isinstance(data, dict) else []
    out: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        target = str(it.get("target", "")).strip()
        if not target:
            continue
        raw_opts = it.get("options", []) if isinstance(it.get("options"), list) else []
        options = [str(o).strip() for o in raw_opts if str(o).strip()]
        out.append({"target": target, "note": str(it.get("note", "")).strip(), "options": options})
    return out[:n]


async def _run_kind(
    kind: SuggestKind,
    system: str,
    draft_text: str,
    provider: LLMProvider,
    model: str,
    n: int,
) -> list[dict[str, Any]]:
    prompt = _build_prompt(kind, system, draft_text, n)
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_SCHEMA)
    items = parse_suggestions(resp.text, n)
    if kind == "reword":
        # Cheap deterministic guarantee that no em dash / `--` slips into an
        # option; full voice repair would cost an LLM call per option.
        for it in items:
            it["options"] = [deterministic_backstop(o) for o in it["options"]]
    return items


def _build_prompt(kind: SuggestKind, system: str, draft_text: str, n: int) -> str:
    rules = render_prompt_rules(
        [
            *_KIND_RULES[kind],
            PromptRule("Return JSON matching the suggestions schema.", OUTPUT_RATIONALE),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels or their rationales into "
                "suggestions.",
                "Those labels are prompt metadata rather than article prose.",
            ),
        ]
    )
    prompt = (
        f"{system}\n\n---\n\n{_DIRECTIVE[kind].format(n=n)}\n\n{rules}\n\n"
        'Suggestions schema: {"suggestions": [{"target": "...", "note": "...", '
        '"options": ["..."]}]}.\n\nDRAFT:\n'
        f"{draft_text}"
    )
    return prompt


async def suggest_improvements(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    kinds: tuple[SuggestKind, ...] = ALL_KINDS,
    per_kind: int = 4,
) -> dict[str, list[dict[str, Any]]]:
    """Return ``{kind: [suggestion, ...]}`` for each requested kind, in voice."""
    from blogforge.voice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=3)
    system = compose_prompt(
        pack_root,
        format=None,
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    draft_text = _draft_text(draft)
    results = await asyncio.gather(
        *(_run_kind(k, system, draft_text, provider, model, per_kind) for k in kinds)
    )
    return dict(zip(kinds, results, strict=True))
