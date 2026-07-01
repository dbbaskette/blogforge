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
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.llm.base import LLMProvider
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
    "fact_check": (
        "Identify up to {n} specific factual claims in this draft that a careful "
        "editor would DOUBLE-CHECK before publishing — statistics, dates, names, "
        "'studies show' assertions, superlatives, strong causal claims. For each, "
        "quote the exact claim verbatim as `target` and in `note` say briefly WHY "
        "it is worth verifying. You CANNOT verify truth — do NOT assert whether a "
        "claim is true or false, only flag what to check. Leave `options` empty. "
        "If nothing stands out, return an empty list."
    ),
    "reword": (
        "Find up to {n} sentences or phrases that could be sharper — wordy, vague, "
        "clichéd, passive, or hedgy. For each, quote the exact text verbatim as "
        "`target`, name the problem in a few words in `note`, and give 2-3 "
        "alternative phrasings in `options` that keep the meaning and the author's "
        "voice. Stay in voice; banished words/phrases (including em dashes) never "
        "appear."
    ),
    "expand": (
        "Find up to {n} spots that would land harder with more substance — a "
        "concrete example, a number, a counterpoint, or a consequence. For each, "
        "quote the exact text where it would go verbatim as `target`, describe "
        "what's thin in `note`, and in `options` give 1-2 specific things the "
        "author could add. Do NOT write the addition — just suggest it."
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
    prompt = (
        f"{system}\n\n---\n\n{_DIRECTIVE[kind].format(n=n)}\n\n"
        'Return JSON: {"suggestions": [{"target": "...", "note": "...", '
        '"options": ["..."]}]}.\n\nDRAFT:\n'
        f"{draft_text}"
    )
    resp = await provider.complete(model=model, prompt=prompt, json_schema=_SCHEMA)
    items = parse_suggestions(resp.text, n)
    if kind == "reword":
        # Cheap deterministic guarantee that no em dash / `--` slips into an
        # option; full voice repair would cost an LLM call per option.
        for it in items:
            it["options"] = [deterministic_backstop(o) for o in it["options"]]
    return items


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
