"""Voice-aware transformation of a selected passage (inline AI editing).

Powers the editor's selection toolbar — rephrase / shorten / expand / fix /
ask. Unlike section generation this operates on an arbitrary fragment and
returns the rewritten fragment synchronously: inline edits are short, so
there's no job or streaming machinery.

The voice setup mirrors `stream_section` (same pack/format/samples → system
prompt) so an inline edit reads in exactly the same voice as the surrounding
prose.
"""
# ruff: noqa: E501

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.generate.formats import resolve_format
from blogforge.llm.base import LLMProvider
from blogforge.prompt_rules import (
    PRESERVATION_RATIONALE,
    TTS_RATIONALE,
    PromptRule,
    render_prompt_rules,
)

InlineAction = Literal["rephrase", "shorten", "expand", "fix", "custom"]

# Short self-correction notes a model sometimes leaks before redoing the answer
# ("…schedules. Wait, I need to fix the em dashes. …schedules."). When present,
# only the text AFTER the last such note is the real final version.
_SELF_CORRECTION_RE = re.compile(
    r"(?i)\b(?:wait|hold on|let me|i need to|i should|on second thought|oops|"
    r"scratch that|correction|my mistake|here'?s the (?:corrected|fixed|revised))\b"
)

_ACTION_DIRECTIVE: dict[str, str] = {
    "rephrase": ("Rewrite the passage in fresh words."),
    "shorten": ("Tighten the passage."),
    "expand": ("Develop the passage further."),
    "fix": ("Fix grammar, clarity, and flow."),
}

_ACTION_RULES: dict[str, tuple[PromptRule, ...]] = {
    "rephrase": (
        PromptRule("Preserve the passage's meaning.", PRESERVATION_RATIONALE),
        PromptRule(
            "Keep roughly the same length.",
            "A rephrase should fit the selected passage's existing place in the article.",
        ),
    ),
    "shorten": (
        PromptRule("Preserve the passage's meaning.", PRESERVATION_RATIONALE),
        PromptRule(
            "Use noticeably fewer words.",
            "The editor selected this action to make the passage more concise.",
        ),
        PromptRule(
            "Cut filler and hedging while keeping the substance.",
            "Conciseness should not discard the point the passage makes.",
        ),
    ),
    "expand": (
        PromptRule(
            "Add one concrete detail, example, or consequence.",
            "An expansion needs useful substance rather than extra wording.",
        ),
        PromptRule(
            "Add substance rather than padding.",
            "The selected text should become more informative, not merely longer.",
        ),
    ),
    "fix": (
        PromptRule("Preserve the passage's meaning.", PRESERVATION_RATIONALE),
        PromptRule(
            "Preserve the author's voice and level of formality.",
            "A grammar or clarity fix should still read like the surrounding approved prose.",
        ),
    ),
}


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


def _build_user_prompt(text: str, action: InlineAction, instruction: str) -> str:
    if action == "custom":
        directive = instruction.strip() or "Improve the passage."
        action_rules: tuple[PromptRule, ...] = ()
    else:
        directive = _ACTION_DIRECTIVE[action]
        action_rules = _ACTION_RULES[action]
    rules = render_prompt_rules(
        [
            *action_rules,
            PromptRule(
                "Return exactly one rewritten passage and nothing else.",
                "The editor replaces the selected text with this response.",
            ),
            PromptRule(
                "Return the rewritten passage as Markdown without a preamble, surrounding quotes, explanation, alternatives, or notes.",
                "The editor splices this response directly into the selected text.",
            ),
            PromptRule(
                "Silently correct any mistake without narrating the correction.",
                "Editorial commentary would be inserted into the article instead of the selected text.",
            ),
            PromptRule(
                "Match the surrounding style and the author's voice.",
                "The replacement must read as part of the existing article.",
            ),
            PromptRule(
                "Do not use banished words or phrases.",
                "Those terms conflict with the author's established voice and explicit preferences.",
            ),
            PromptRule(
                "Do not use em dashes.",
                TTS_RATIONALE,
            ),
            PromptRule(
                "Do not copy the `Rule` or `Because` labels into the rewritten passage.",
                "Those labels are prompt metadata rather than article prose.",
            ),
        ]
    )
    return f"{directive}\n\n{rules}\n\nPASSAGE:\n{text.strip()}"


def _clean_inline_output(text: str) -> str:
    """Strip stray quotes and any self-correction narration a model leaks.

    If the reply narrates a correction and then redoes the answer, keep only the
    text after the last short self-correction note — that's the real output.
    """
    s = text.strip().strip("\"'`“”").strip()
    sentences = re.split(r"(?<=[.!?])\s+", s)
    last_meta = -1
    for i, sent in enumerate(sentences):
        # A self-correction note is short and contains a meta marker.
        if len(sent) < 80 and _SELF_CORRECTION_RE.search(sent):
            last_meta = i
    if 0 <= last_meta < len(sentences) - 1:
        s = " ".join(sentences[last_meta + 1 :]).strip()
    return s.strip("\"'`“”").strip()


async def transform_text(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    text: str,
    action: InlineAction,
    instruction: str = "",
) -> str:
    """Return ``text`` rewritten per ``action`` (or ``instruction`` when
    ``action == "custom"``), in the draft's voice."""
    from blogforge.voice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=3)
    system = compose_prompt(
        pack_root,
        format=resolve_format(pack_root, draft.idea.format),
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    user = _build_user_prompt(text, action, instruction)
    full_prompt = f"{system}\n\n---\n\n{user}"
    resp = await provider.complete(model=model, prompt=full_prompt)
    out = _clean_inline_output(resp.text)
    # Enforce the mechanical voice rules so an inline edit — including an
    # accepted Proofreader fix — can't leave an em dash / `--` / banished tell
    # behind (which would just get re-flagged on the next lint). Best-effort:
    # never fail the edit if the manifest is an unexpected shape.
    from blogforge.config import get_settings

    if get_settings().enforce_voice_rules:
        try:
            from blogforge.voice.enforce import enforce_voice_rules
            from blogforge.voice.packs.manifest import Manifest

            out = await enforce_voice_rules(out, Manifest.model_validate(manifest), provider, model)
        except Exception:
            pass
    return out
