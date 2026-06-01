"""Single-pass whole-document generation.

Section-by-section composition — even sequential with prior-section context —
keeps re-entering "write a section" mode, and the model recaps each time, so
drafts come out repetitive. This composes the ENTIRE post in one LLM call from
the outline: the model holds the whole argument at once and naturally avoids
restating itself. The result is then split back onto the existing Section model
(by H2 heading) so per-section editing, regenerate, and version history keep
working unchanged.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from jinja2 import Template

from blogforge.drafts.models import Draft, Section
from blogforge.llm.base import LLMProvider

_PROMPT_PATH = Path(__file__).parent / "prompts" / "document.j2"

# Splits on markdown H2 headings, capturing the heading text.
_H2_RE = re.compile(r"(?m)^##[ \t]+(.+?)[ \t]*$")


def _auto_pick_samples(manifest: dict[str, Any], n: int = 3) -> list[str]:
    samples = (manifest.get("samples") or [])[:n]
    return [str(s.get("id", "")) for s in samples if s.get("id")]


def _render_document_prompt(draft: Draft) -> str:
    template = Template(_PROMPT_PATH.read_text(encoding="utf-8"))
    sections = draft.outline.sections if draft.outline else draft.sections
    return template.render(
        title=draft.title or draft.idea.topic,
        opening_hook=(draft.outline.opening_hook if draft.outline else ""),
        sections=sections,
        target_words=draft.idea.target_words,
    )


def split_document(markdown: str, sections: list[Section]) -> dict[str, str]:
    """Map a whole-document markdown body onto section ids by H2 heading.

    The model is told to emit each section's title verbatim as an ``## ``
    heading in order, so we split on H2s and zip with ``sections`` positionally.
    Any lead text before the first heading is folded into the first section;
    if the model emits more headings than sections, the overflow is appended to
    the last section so nothing is dropped. Returns ``{section_id: body}`` with
    heading lines stripped (assemble_markdown re-adds the title).
    """
    if not sections:
        return {}

    matches = list(_H2_RE.finditer(markdown))
    if not matches:
        # No headings at all — put the whole thing in the first section rather
        # than lose it. Better a lumpy draft than an empty one.
        return {sections[0].id: markdown.strip()}

    # Body blocks: text from each heading to the next (heading line excluded).
    blocks: list[str] = []
    lead = markdown[: matches[0].start()].strip()
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown)
        blocks.append(markdown[start:end].strip())
    if lead:  # preamble before the first heading → prepend to first block
        blocks[0] = f"{lead}\n\n{blocks[0]}".strip()

    result: dict[str, str] = {}
    for idx, section in enumerate(sections):
        if idx < len(blocks):
            result[section.id] = blocks[idx]
    # Overflow headings (model emitted more sections than the outline) — append
    # their bodies to the last section so the prose survives.
    if len(blocks) > len(sections):
        last_id = sections[-1].id
        extra = "\n\n".join(blocks[len(sections) :])
        result[last_id] = f"{result.get(last_id, '')}\n\n{extra}".strip()
    return result


async def generate_document(
    draft: Draft,
    pack_root: Path,
    manifest: dict[str, Any],
    provider: LLMProvider,
    *,
    model: str,
    reference_context: str = "",
) -> str:
    """Compose the entire post in one call. Returns the full markdown body
    (``## `` headings + prose), to be split via :func:`split_document`."""
    from myvoice import compose_prompt

    sample_ids = _auto_pick_samples(manifest, n=3)
    system = compose_prompt(
        pack_root,
        format=draft.idea.format,
        samples=sample_ids if sample_ids else None,
        draft=None,
    )
    user = _render_document_prompt(draft)
    if reference_context:
        user = f"{reference_context}\n\n---\n\n{user}"
    full_prompt = f"{system}\n\n---\n\n{user}"
    resp = await provider.complete(model=model, prompt=full_prompt)
    return resp.text.strip()
