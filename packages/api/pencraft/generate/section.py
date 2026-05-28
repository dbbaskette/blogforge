"""Stream a section's prose via provider.stream()."""
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from jinja2 import Template

from pencraft.drafts.models import Draft, Section
from pencraft.llm.base import LLMProvider, StreamChunk

_PROMPT_PATH = Path(__file__).parent / "prompts" / "section.j2"


def _render_outline_md(draft: Draft, current_id: str) -> str:
    lines: list[str] = []
    if not draft.outline:
        return ""
    for i, s in enumerate(draft.outline.sections, start=1):
        marker = "**" if s.id == current_id else ""
        lines.append(f"{i}. {marker}{s.title}{marker}")
    return "\n".join(lines)


def _render_section_prompt(draft: Draft, section: Section) -> str:
    sections = draft.outline.sections if draft.outline else []
    total = max(len(sections), 1)
    position_idx = next((i for i, s in enumerate(sections) if s.id == section.id), 0)
    is_first = position_idx == 0
    is_last = position_idx == total - 1
    template = Template(_PROMPT_PATH.read_text(encoding="utf-8"))
    return template.render(
        title=draft.title or draft.idea.topic,
        outline_md=_render_outline_md(draft, section.id),
        opening_hook=(draft.outline.opening_hook if draft.outline else ""),
        section_title=section.title,
        section_brief=section.brief,
        target_section_words=max(150, draft.idea.target_words // total),
        position=f"{position_idx + 1} of {total}",
        is_first=is_first,
        is_last=is_last,
    )


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


async def stream_section(
    draft: Draft,
    section: Section,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    reference_context: str = "",
) -> AsyncIterator[StreamChunk]:
    """Stream a section's body. `reference_context` is the pre-assembled
    "## Reference Materials" block (see pencraft.generate.references);
    when non-empty it's prepended to the user prompt with a `---`."""
    from myvoice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=3)
    system = compose_prompt(
        pack_root,
        format=draft.idea.format,
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    user = _render_section_prompt(draft, section)
    if reference_context:
        user = f"{reference_context}\n\n---\n\n{user}"
    full_prompt = f"{system}\n\n---\n\n{user}"
    async for chunk in provider.stream(model=model, prompt=full_prompt):
        yield chunk
