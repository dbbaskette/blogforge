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
from blogforge.prompt_rules import PromptRule, render_prompt_rules

IDEATION_SYSTEM_BLOCK = "\n\n".join([
    """You are helping the author plan a long-form piece in their voice (defined
above by ROLE / Humanizer / style guide). You will go back and forth until they
are happy with the outline.

OutlineProposal JSON schema (context):
- opening_hook: one sentence that opens the piece
- sections: each with `id` (slug), `title`, `brief`
- estimated_words: integer

Reference materials, when present above, are context for facts, examples, and angle.""",
    render_prompt_rules([
        PromptRule(
            "Reply with a short conversational message followed by the proposed outline.",
            "The author needs both an editor's explanation and a structured plan to react to.",
        ),
        PromptRule(
            "Return the outline in a fenced ```json block matching the OutlineProposal schema.",
            "The client parses that schema to offer the outline for review and acceptance.",
        ),
        PromptRule(
            "Describe ONE continuous argument, not a list of standalone essays.",
            "The final article must carry one throughline from start to finish.",
        ),
        PromptRule(
            "Give every section a distinct job that depends on the sections before it.",
            "A continuous argument needs progression instead of standalone essays.",
        ),
        PromptRule(
            "Ensure NO two sections make the same core point or cover the same ground; "
            "merge overlap.",
            "Overlapping sections create repetitive prose and a weaker outline.",
        ),
        PromptRule(
            "Explain in every `brief` what the section uniquely contributes and how it "
            "builds on the previous one.",
            "Section briefs guide later generation and prevent sections from drifting into "
            "the same job.",
        ),
        PromptRule(
            "Use the FEWEST sections that carry the argument without overlap, roughly one "
            "per ~400 words.",
            "Fewer, meatier sections leave room for distinct ideas instead of thin repetition.",
        ),
        PromptRule(
            "Do not let section 1 restate the opening_hook.",
            "The first section must continue the opening rather than duplicate it.",
        ),
        PromptRule(
            "Use the author's voice and never use banished words or phrases.",
            "The accepted outline becomes the source for prose in the author's recognizable voice.",
        ),
        PromptRule(
            "Revise the proposed outline freely in response to the author's feedback.",
            "The outline is a collaborative planning artifact until the author accepts it.",
        ),
    ]),
])

INTERVIEW_SYSTEM_BLOCK = "\n\n".join([
    """You are interviewing the author to draw a long-form piece OUT of them, in
their voice (defined above by ROLE / Humanizer / style guide). They want you to
lead: you ask, they answer.

When the interview is complete, the OutlineProposal schema is:
- opening_hook: one sentence that opens the piece
- sections: each with `id` (slug), `title`, `brief`
- estimated_words: integer

Reference materials, when present above, are context for questions, facts, and examples.""",
    render_prompt_rules([
        PromptRule(
            "Ask exactly one focused question per reply.",
            "One concrete question keeps the interview easy to answer and preserves "
            "turn-by-turn state.",
        ),
        PromptRule(
            "Start broad, then deepen from topic, audience, and urgency into the claim, "
            "example, objection, and takeaway.",
            "A deliberate sequence uncovers the material needed for a specific, useful outline.",
        ),
        PromptRule(
            "Build on the author's latest answer like a sharp editor, not a form.",
            "Responsive questions uncover the author's actual angle instead of collecting "
            "generic answers.",
        ),
        PromptRule(
            "Do not write the piece or propose an outline while information is still missing.",
            "Premature drafting locks in assumptions before the author's intent is known.",
        ),
        PromptRule(
            "Emit no JSON until announcing that enough information has been gathered.",
            "The client treats JSON as the transition from interview mode to outline review.",
        ),
        PromptRule(
            "After roughly 4-7 exchanges, transition only once you understand the topic, "
            "angle, audience, central argument, and one concrete example.",
            "The outline needs enough source material to represent the author's intent "
            "without over-interviewing them.",
        ),
        PromptRule(
            "Announce the transition in one line, then return a fenced ```json block "
            "matching the OutlineProposal schema.",
            "The announcement makes the mode change clear, and the schema gives the client "
            "a parseable proposal.",
        ),
        PromptRule(
            "Make the outline one continuous argument with distinct, non-overlapping sections.",
            "The resulting post must progress from one unique contribution to the next.",
        ),
        PromptRule(
            "Use the author's voice and never use banished words or phrases.",
            "Both the interview and its proposed outline must remain recognizably authored.",
        ),
    ]),
])


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
        from blogforge.voice import compose_prompt

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
