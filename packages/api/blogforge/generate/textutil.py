"""Small text helpers shared across generators."""

from __future__ import annotations

import re

_CODE_RE = re.compile(r"`([^`]+)`")
_BOLD_STAR_RE = re.compile(r"\*\*([^*]+)\*\*")
_BOLD_UNDER_RE = re.compile(r"__([^_]+)__")
_ITALIC_STAR_RE = re.compile(r"\*([^*]+)\*")
_ITALIC_UNDER_RE = re.compile(r"(^|[^\w])_([^_]+)_(?![\w])")


def strip_inline_emphasis(text: str) -> str:
    """Remove inline Markdown emphasis (bold/italic/code) for DISPLAY or for
    matching heading text — never for storage. A pasted ``## **ROTATE**`` keeps
    its markers in the document (so export is faithful), but the UI and the
    title→section matching use the clean form. Handles stray/unbalanced markers
    (a truncated ``**Title``) and leaves ``snake_case`` alone.
    """
    text = _CODE_RE.sub(r"\1", text)
    text = _BOLD_STAR_RE.sub(r"\1", text)
    text = _BOLD_UNDER_RE.sub(r"\1", text)
    text = _ITALIC_STAR_RE.sub(r"\1", text)
    text = _ITALIC_UNDER_RE.sub(r"\1\2", text)
    text = text.replace("**", "").replace("`", "")
    return text.strip()
