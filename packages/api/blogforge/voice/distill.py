"""Distil a set of writing samples into a markdown style guide."""
from __future__ import annotations

from blogforge.llm.base import LLMProvider

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
    return (
        "Analyze the writing samples below and produce a concise markdown style guide "
        "that captures how this author writes. Cover, each with concrete do's & don'ts "
        "an imitator can follow:\n"
        "- Tone and register\n"
        "- Sentence rhythm and length (short/long mix, fragments)\n"
        "- How the author opens pieces (question? scene? claim? story?)\n"
        "- Transition habits between ideas and sections\n"
        "- Opinion strength — hedged or declarative, and when\n"
        "- Anecdote and aside frequency — how often the author steps out of the argument\n"
        "- Humor style, if any (dry, self-deprecating, none)\n"
        "- Vocabulary tendencies and formatting habits\n"
        "Write it as guidance an AI could follow to imitate the voice. Output ONLY the "
        "markdown style guide.\n\n"
        f"SAMPLES:\n\n{body}"
    )


async def distill_style(
    sample_texts: list[str],
    provider: LLMProvider,
    *,
    model: str,
) -> str:
    resp = await provider.complete(model=model, prompt=_build_prompt(sample_texts))
    return resp.text.strip()
