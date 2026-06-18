"""Ideation: chat-driven outline proposal in the research stage.

Each assistant reply has two parts:

1. A short conversational message — questions for the author, reasoning for
   the proposed outline, etc.
2. A fenced JSON block matching the OutlineProposal schema.

When the author Accepts, the JSON block becomes their `draft.outline` and the
stage advances. We stream the LLM reply to the FE chunk-by-chunk, then parse
the JSON block once the stream completes and emit a final result event.
"""
from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, TypedDict

from blogforge.drafts.models import Draft, OutlineProposal
from blogforge.generate.formats import resolve_format
from blogforge.llm.base import LLMProvider

IDEATION_SYSTEM_BLOCK = """\
You are helping the author plan a long-form piece in their voice (defined
above by ROLE / Humanizer / style guide). You will go back and forth with
them until they are happy with the outline.

Each of your replies has two parts:

1. A short conversational message — questions you have for them, or your
   reasoning for the proposed outline.

2. A JSON block matching the OutlineProposal schema, fenced with ```json,
   containing:
     - opening_hook: one sentence that opens the piece
     - sections: each with `id` (slug), `title`, `brief`
     - estimated_words: integer

The outline must describe ONE continuous argument, not a list of standalone
essays. Hold yourself to these rules:

- The sections form a single PROGRESSION that builds start to finish (e.g.
  problem → complication → mechanism → implication → resolution). Each
  section has a DISTINCT job and depends on the ones before it.
- NO two sections make the same core point or cover the same ground. If two
  ideas overlap, merge them.
- Each `brief` says what that section uniquely contributes and how it builds
  on the previous one.
- Use the FEWEST sections that carry the argument without overlap — roughly
  one section per ~400 words (typically 3–6). Fewer, meatier sections beat
  many thin ones; thin sections are what cause repetition.
- Section 1 must not restate the opening_hook.

The author may reference materials they've shared (under "## Reference
Materials" above). Draw on them for facts, examples, and angle. Stay in
the author's voice — banished words / phrases never appear.

When the author accepts, this JSON becomes their outline. Edit it freely
in response to feedback ("shorter", "add a section on X", "make 3
punchier", "start with a different hook").
"""

INTERVIEW_SYSTEM_BLOCK = """\
You are interviewing the author to draw a long-form piece OUT of them, in their
voice (defined above by ROLE / Humanizer / style guide). They want you to lead:
you ask, they answer.

How to run the interview:
- Ask EXACTLY ONE focused question per reply. Keep it short and concrete.
- Start broad (what's the piece about, who is it for, why now), then go deeper
  (the central claim, the strongest concrete example, the objection to address,
  the takeaway you want to leave them with).
- Build on what they just said — react like a sharp editor, not a form.
- Do NOT write the piece, and do NOT propose an outline while you are still
  learning. Emit NO JSON during the interview.
- After roughly 4–7 exchanges, once you understand the topic, angle, audience,
  the central argument, and at least one concrete example, say so in one line
  ("I think I've got enough — here's an outline to react to:") and ONLY THEN
  include a JSON block matching the OutlineProposal schema, fenced with ```json:
     - opening_hook: one sentence that opens the piece
     - sections: each with `id` (slug), `title`, `brief`
     - estimated_words: integer
  The outline must describe ONE continuous argument (problem → complication →
  mechanism → implication → resolution), with no two sections making the same
  point — the same outline rules as a normal proposal.

If the author has shared reference materials (under "## Reference Materials"
above), let them inform your questions. Stay in the author's voice; banished
words / phrases never appear.
"""


def _seed_user_message(draft: Draft) -> str:
    """Bootstrap message for the very first ideation turn.

    Carries the topic + bullets + notes from the static idea form so the
    LLM has something to work from on turn 0."""
    idea = draft.idea
    parts = [
        f"Topic: {idea.topic}",
        f"Target length: ~{idea.target_words} words",
    ]
    if idea.bullets:
        parts.append("Initial bullets:")
        parts.extend(f"- {b}" for b in idea.bullets if b)
    if idea.notes:
        parts.append("")
        parts.append(f"Notes: {idea.notes}")
    return "\n".join(parts)


def build_ideation_prompt(
    draft: Draft, *, new_user_content: str, reference_context: str
) -> str:
    """Build the user-side prompt body for the LLM call.

    Layout (top to bottom):
        [reference_context, if any]
        [seed message from idea]   ← on turn 0 only; otherwise drawn from history
        [conversation history, alternating]
        [new user message]
    """
    blocks: list[str] = []

    if reference_context:
        blocks.append(reference_context.rstrip())
        blocks.append("---")

    # Turn 0 has no history yet; seed from the idea form so the LLM sees the
    # topic without us having to persist a fake "user" message first.
    history = list(draft.ideation_messages)
    if not history:
        blocks.append("**Author (seed):**")
        blocks.append(_seed_user_message(draft))
        blocks.append("")

    for msg in history:
        speaker = "Author" if msg.role == "user" else "Assistant (you)"
        blocks.append(f"**{speaker}:**")
        blocks.append(msg.content)
        blocks.append("")

    if new_user_content:
        blocks.append("**Author:**")
        blocks.append(new_user_content)
        blocks.append("")
        blocks.append("**Assistant (you):**")

    return "\n".join(blocks).rstrip() + "\n"


_JSON_FENCE_RE = re.compile(r"```json\s*\n(.*?)\n\s*```", re.DOTALL)
_JSON_OBJECT_RE = re.compile(r"\{(?:[^{}]|\{[^{}]*\})*\}", re.DOTALL)


def parse_proposed_outline(text: str) -> OutlineProposal | None:
    """Pull the OutlineProposal JSON out of an assistant reply.

    Tries a fenced ```json``` block first; falls back to the first
    parseable {...} object in the text. Returns None on any failure;
    callers surface that as "the model didn't include a structured
    outline — ask it to" rather than failing the whole reply."""
    candidates: list[str] = []
    fenced = _JSON_FENCE_RE.findall(text)
    candidates.extend(fenced)
    if not fenced:
        candidates.extend(_JSON_OBJECT_RE.findall(text))

    for raw in candidates:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        try:
            return OutlineProposal.model_validate(data)
        except Exception:
            continue
    return None


class _DeltaEvent(TypedDict):
    kind: str  # "delta"
    delta: str


class _ResultEvent(TypedDict):
    kind: str  # "result"
    text: str
    proposed_outline: OutlineProposal | None


IdeationEvent = _DeltaEvent | _ResultEvent


async def stream_ideation(
    draft: Draft,
    *,
    new_user_content: str,
    reference_context: str,
    provider: LLMProvider,
    model: str,
    pack_root: Path | None,
    manifest: dict[str, Any],
    mode: str = "ideate",
) -> AsyncIterator[IdeationEvent]:
    """Stream the assistant's reply.

    Yields one `delta` event per LLM chunk and a final `result` event
    carrying the full assistant text + the parsed `proposed_outline`
    (which may be None if the model didn't emit a JSON block).
    """
    if pack_root is not None:
        from myvoice import compose_prompt

        sample_ids = _auto_pick_samples(manifest, n=2)
        system = compose_prompt(
            pack_root,
            format=resolve_format(pack_root, draft.idea.format),
            samples=sample_ids if sample_ids else None,
            draft=None,
        )
    else:
        system = ""

    block = INTERVIEW_SYSTEM_BLOCK if mode == "interview" else IDEATION_SYSTEM_BLOCK
    system = f"{system}\n\n---\n\n{block}" if system else block
    user = build_ideation_prompt(
        draft,
        new_user_content=new_user_content,
        reference_context=reference_context,
    )
    full_prompt = f"{system}\n\n---\n\n{user}"

    buf = ""
    async for chunk in provider.stream(model=model, prompt=full_prompt):
        if chunk.delta:
            buf += chunk.delta
            yield {"kind": "delta", "delta": chunk.delta}

    yield {
        "kind": "result",
        "text": buf,
        "proposed_outline": parse_proposed_outline(buf),
    }


def _auto_pick_samples(manifest: dict[str, Any], n: int = 2) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]
