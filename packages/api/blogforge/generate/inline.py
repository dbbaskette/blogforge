"""Voice-aware transformation of a selected passage (inline AI editing).

Powers the editor's selection toolbar — rephrase / shorten / expand / fix /
ask. Unlike section generation this operates on an arbitrary fragment and
returns the rewritten fragment synchronously: inline edits are short, so
there's no job or streaming machinery.

The voice setup mirrors `stream_section` (same pack/format/samples → system
prompt) so an inline edit reads in exactly the same voice as the surrounding
prose.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Literal

from blogforge.drafts.models import Draft
from blogforge.generate.formats import resolve_format
from blogforge.llm.base import LLMProvider

InlineAction = Literal["rephrase", "shorten", "expand", "fix", "custom"]

# Short self-correction notes a model sometimes leaks before redoing the answer
# ("…schedules. Wait, I need to fix the em dashes. …schedules."). When present,
# only the text AFTER the last such note is the real final version.
_SELF_CORRECTION_RE = re.compile(
    r"(?i)\b(?:wait|hold on|let me|i need to|i should|on second thought|oops|"
    r"scratch that|correction|my mistake|here'?s the (?:corrected|fixed|revised))\b"
)

_ACTION_DIRECTIVE: dict[str, str] = {
    "rephrase": (
        "Rewrite the passage to say the same thing in fresh words — different "
        "phrasing, same meaning, roughly the same length."
    ),
    "shorten": (
        "Tighten the passage: same meaning, noticeably fewer words. Cut filler "
        "and hedging, keep the substance."
    ),
    "expand": (
        "Develop the passage further with one concrete detail, example, or "
        "consequence. Add substance, not padding."
    ),
    "fix": (
        "Fix grammar, clarity, and flow. Do NOT change the meaning, the voice, "
        "or the level of formality."
    ),
}


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


def _build_user_prompt(text: str, action: InlineAction, instruction: str) -> str:
    if action == "custom":
        directive = instruction.strip() or "Improve the passage."
    else:
        directive = _ACTION_DIRECTIVE[action]
    return (
        f"{directive}\n\n"
        "Return ONLY the final rewritten passage as markdown — output exactly "
        "one version and nothing else: no preamble, no surrounding quotes, no "
        "explanation, no alternatives, and no notes about what you changed. If "
        "you catch a mistake (e.g. an em dash), silently correct it and output "
        "only the fixed final version — never narrate the correction. Match the "
        "surrounding style and stay in the author's voice; banished "
        "words/phrases (including em dashes) never appear.\n\n"
        "PASSAGE:\n"
        f"{text.strip()}"
    )


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
    return _clean_inline_output(resp.text)
