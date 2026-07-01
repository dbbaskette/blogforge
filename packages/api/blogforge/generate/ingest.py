"""Ingest an already-written draft (paste) into editable sections.

The "I already wrote it" compose mode: a writer pastes a finished post and we
land it in the normal editor as a sections-stage draft, so every shaping tool
(proofreader, inline AI, headline lab, Shape Assistant) works on it unchanged.

Splitting mirrors ``split_document``: sections break on H2 headings. Unlike
``split_document`` (which maps generated prose onto an *existing* outline) this
parses NEW sections out of arbitrary markdown — keeping each section's body —
and falls back to a single section when the paste has no headings, so nothing
is ever dropped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from uuid import uuid4

from blogforge.drafts.models import Section

# One '#' then whitespace (an H1); '##'+ never matches because the second '#'
# isn't whitespace. H2 is the section delimiter.
_H1_RE = re.compile(r"(?m)^#[ \t]+(.+?)[ \t]*$")
_H2_RE = re.compile(r"(?m)^##[ \t]+(.+?)[ \t]*$")

_MAX_TITLE = 120

# Inline-emphasis markers that shouldn't survive into a plain-text HEADING —
# a pasted "## **ROTATE**" would otherwise show the literal ** in the title.
_CODE_RE = re.compile(r"`([^`]+)`")
_BOLD_STAR_RE = re.compile(r"\*\*([^*]+)\*\*")
_BOLD_UNDER_RE = re.compile(r"__([^_]+)__")
_ITALIC_STAR_RE = re.compile(r"\*([^*]+)\*")
_ITALIC_UNDER_RE = re.compile(r"(^|[^\w])_([^_]+)_(?![\w])")


def strip_heading_emphasis(text: str) -> str:
    """Remove inline Markdown emphasis (bold/italic/code) from heading text so
    section titles and the draft title render clean — including stray/unbalanced
    markers left by a truncated heading."""
    text = _CODE_RE.sub(r"\1", text)
    text = _BOLD_STAR_RE.sub(r"\1", text)
    text = _BOLD_UNDER_RE.sub(r"\1", text)
    text = _ITALIC_STAR_RE.sub(r"\1", text)
    text = _ITALIC_UNDER_RE.sub(r"\1\2", text)
    text = text.replace("**", "").replace("`", "")
    return text.strip()


@dataclass
class Ingested:
    title: str
    sections: list[Section]


def _word_count(text: str) -> int:
    return len(text.split())


def _first_nonempty_line(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped
    return ""


def _clamp_title(title: str) -> str:
    title = strip_heading_emphasis(title)
    if len(title) > _MAX_TITLE:
        return title[: _MAX_TITLE - 1].rstrip() + "…"
    return title


def _section(title: str, content: str) -> Section:
    content = content.strip()
    return Section(
        id=uuid4().hex,
        title=strip_heading_emphasis(title),
        content_md=content,
        status="edited",
        word_count=_word_count(content),
    )


def ingest_document(markdown: str) -> Ingested:
    """Parse pasted markdown into a title + editable sections.

    - Title: first ``# H1``, else the first non-empty line, else a default.
    - Sections split on ``## H2``; text before the first H2 folds into section 1.
    - No H2 headings at all → a single section holding the whole draft.
    - Empty input → no sections (the caller rejects it).
    """
    text = (markdown or "").strip()
    if not text:
        return Ingested(title="Imported draft", sections=[])

    h1 = _H1_RE.search(text)
    title = _clamp_title(h1.group(1) if h1 else (_first_nonempty_line(text) or "Imported draft"))

    # Drop a leading H1 line so the title isn't duplicated inside section bodies.
    body = text
    if h1 and h1.start() == 0:
        body = text[h1.end() :].lstrip("\n")

    h2s = list(_H2_RE.finditer(body))
    if not h2s:
        return Ingested(title=title, sections=[_section(title, body)])

    lead = body[: h2s[0].start()].strip()
    sections: list[Section] = []
    for i, m in enumerate(h2s):
        start = m.end()
        end = h2s[i + 1].start() if i + 1 < len(h2s) else len(body)
        content = body[start:end].strip()
        if i == 0 and lead:
            content = f"{lead}\n\n{content}".strip()
        sections.append(_section(m.group(1), content))
    return Ingested(title=title, sections=sections)
