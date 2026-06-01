"""ANALYZE stage for outline: render prompt, call LLM with json_schema, validate."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Template

from blogforge.drafts.models import IdeaInput, OutlineProposal
from blogforge.llm.base import LLMProvider

# Reference context is built by the caller (route handler) and passed in
# via the `reference_context` kwarg; that keeps the generator stateless
# and easy to test without spinning up S3.

_PROMPT_PATH = Path(__file__).parent / "prompts" / "outline.j2"

# Bias toward fewer, meatier sections. Thin sections (~150-250 words) are what
# breed cross-section repetition: there isn't room to say something distinct,
# so each one restates the thesis. ~400 words/section gives each a real job.
_WORDS_PER_SECTION = 400


def _section_budget(target_words: int) -> tuple[int, int, int]:
    """Return (min_sections, max_sections, words_per_section) for a length.

    Scales the section count to the word budget and clamps to 3–7 so short
    posts don't get sliced into thin, overlapping fragments and long ones
    don't sprawl."""
    ideal = min(7, max(3, round(target_words / _WORDS_PER_SECTION)))
    return max(3, ideal - 1), ideal + 1, round(target_words / ideal)


def _render_outline_prompt(idea: IdeaInput) -> str:
    template = Template(_PROMPT_PATH.read_text(encoding="utf-8"))
    min_sections, max_sections, words_per_section = _section_budget(idea.target_words)
    return template.render(
        idea=idea,
        min_sections=min_sections,
        max_sections=max_sections,
        words_per_section=words_per_section,
    )


def _auto_pick_samples(manifest: dict[str, Any], n: int = 2) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


async def propose_outline(
    idea: IdeaInput,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    reference_context: str = "",
) -> OutlineProposal:
    """Single LLM call. Returns a validated OutlineProposal.

    `reference_context` is the pre-assembled "## Reference Materials"
    block (see blogforge.generate.references.get_reference_context). When
    non-empty it gets prepended to the user prompt with a `---`
    separator — the LLM sees the materials before the idea brief.
    """
    from myvoice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=2)
    system = compose_prompt(
        pack_root,
        format=idea.format,
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    user = _render_outline_prompt(idea)
    if reference_context:
        user = f"{reference_context}\n\n---\n\n{user}"
    schema = OutlineProposal.model_json_schema()
    full_prompt = f"{system}\n\n---\n\n{user}"
    response = await provider.complete(model=model, prompt=full_prompt, json_schema=schema)
    return OutlineProposal.model_validate_json(response.text)
