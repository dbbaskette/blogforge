"""Distil a set of writing samples into a markdown style guide."""
from __future__ import annotations

from blogforge.llm.base import LLMProvider
from blogforge.prompt_rules import (
    OUTPUT_RATIONALE,
    VOICE_RATIONALE,
    PromptRule,
    render_prompt_rules,
)

_MAX_CHARS = 24000


def _build_prompt(sample_texts: list[str]) -> str:
    joined: list[str] = []
    used = 0
    for t in sample_texts:
        t = t.strip()
        if used + len(t) > _MAX_CHARS:
            break
        joined.append(t)
        used += len(t)
    body = "\n\n--- SAMPLE ---\n\n".join(joined)
    rules = render_prompt_rules([
        PromptRule(
            "Analyze the writing samples and produce a concise markdown style guide "
            "that captures how this author writes.",
            "A concrete guide gives future writing tasks a reliable voice reference.",
        ),
        PromptRule(
            "Cover each requested trait with concrete do's and don'ts an imitator can follow.",
            "Specific guidance preserves the author's recognizable voice instead of "
            "producing generic advice.",
        ),
        PromptRule(
            "Write guidance an AI can follow to imitate the author's voice.",
            VOICE_RATIONALE,
        ),
        PromptRule(
            "Return only the markdown style guide.",
            OUTPUT_RATIONALE,
        ),
    ])
    traits = (
        "- Tone and register\n"
        "- Sentence rhythm and length (short/long mix, fragments)\n"
        "- How the author opens pieces (question? scene? claim? story?)\n"
        "- Transition habits between ideas and sections\n"
        "- Opinion strength — hedged or declarative, and when\n"
        "- Anecdote and aside frequency — how often the author steps out of the argument\n"
        "- Humor style, if any (dry, self-deprecating, none)\n"
        "- Vocabulary tendencies and formatting habits"
    )
    return f"{rules}\n\nRequested traits:\n{traits}\n\nSAMPLES:\n\n{body}"


async def distill_style(
    sample_texts: list[str],
    provider: LLMProvider,
    *,
    model: str,
) -> str:
    resp = await provider.complete(model=model, prompt=_build_prompt(sample_texts))
    return resp.text.strip()
