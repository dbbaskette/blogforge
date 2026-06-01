"""Stream a section's prose via provider.stream()."""
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from jinja2 import Template

from blogforge.drafts.models import Draft, Section
from blogforge.llm.base import LLMProvider, StreamChunk

_PROMPT_PATH = Path(__file__).parent / "prompts" / "section.j2"

# How many characters of already-written preceding prose to feed a section so
# it continues the piece instead of restarting it. Closest sections are kept in
# full; older ones are trimmed first when the budget is tight.
_STORY_SO_FAR_BUDGET = 6000


def _render_outline_md(draft: Draft, current_id: str) -> str:
    lines: list[str] = []
    if not draft.outline:
        return ""
    for i, s in enumerate(draft.outline.sections, start=1):
        marker = "**" if s.id == current_id else ""
        lines.append(f"{i}. {marker}{s.title}{marker}")
    return "\n".join(lines)


def _is_written(section: Section) -> bool:
    return bool(section.content_md.strip()) and section.status in ("ready", "edited")


def _render_story_so_far(draft: Draft, current_idx: int) -> str:
    """Prose of the already-written sections that precede this one, so the model
    continues one coherent piece rather than re-introducing the topic.

    Walks nearest-first and stops at the character budget, so the immediately
    preceding context always survives even on a long draft; the surviving
    sections are then emitted in document order.
    """
    budget = _STORY_SO_FAR_BUDGET
    chosen: list[tuple[str, str]] = []
    for s in reversed(draft.sections[:current_idx]):
        if not _is_written(s):
            continue
        body = s.content_md.strip()
        snippet = body if len(body) <= budget else "…" + body[-budget:]
        chosen.append((s.title, snippet))
        budget -= len(snippet)
        if budget <= 0:
            break
    return "\n\n".join(f"### {title}\n{body}" for title, body in reversed(chosen))


def _render_whats_next(draft: Draft, current_idx: int) -> str:
    """Titles + briefs of the sections that come after this one, so it hands off
    cleanly instead of pre-empting ground a later section will cover."""
    lines: list[str] = []
    for s in draft.sections[current_idx + 1 :]:
        brief = (s.brief or "").strip()
        lines.append(f"- {s.title}" + (f": {brief}" if brief else ""))
    return "\n".join(lines)


def _render_section_prompt(draft: Draft, section: Section) -> str:
    # Position from the section list (where the written prose lives), falling
    # back to outline order; the two are kept in sync.
    sections = draft.sections or (draft.outline.sections if draft.outline else [])
    total = max(len(sections), 1)
    position_idx = next((i for i, s in enumerate(sections) if s.id == section.id), 0)
    is_first = position_idx == 0
    is_last = position_idx == total - 1
    template = Template(_PROMPT_PATH.read_text(encoding="utf-8"))
    return template.render(
        title=draft.title or draft.idea.topic,
        outline_md=_render_outline_md(draft, section.id),
        opening_hook=(draft.outline.opening_hook if draft.outline else ""),
        story_so_far=_render_story_so_far(draft, position_idx),
        whats_next=_render_whats_next(draft, position_idx),
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
    instruction: str = "",
) -> AsyncIterator[StreamChunk]:
    """Stream a section's body. `reference_context` is the pre-assembled
    "## Reference Materials" block (see blogforge.generate.references);
    when non-empty it's prepended to the user prompt with a `---`.

    `instruction` is an optional author note steering this regeneration
    ("tighten this", "add a concrete example", "less formal"); when set
    it's appended to the user prompt as an explicit revision directive."""
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
    if instruction.strip():
        user = (
            f"{user}\n\n---\n\nREVISION DIRECTIVE — rewrite the section above "
            f"following this instruction, staying in voice:\n{instruction.strip()}"
        )
    full_prompt = f"{system}\n\n---\n\n{user}"
    async for chunk in provider.stream(model=model, prompt=full_prompt):
        yield chunk
