"""Strip editorial scaffolding from draft markdown before it reaches any
generator, scorer, or the publish assembler.

Authors park non-article material in a draft (alternate versions, reminders,
cross-references to relocate) using mathematical white brackets (U+27E6 / U+27E7)
or standard HTML comments. That content must never ground a generated answer or
reach a published post, so it is removed here at the single point where draft
text is prepared for the model.

Convention:
- A BLOCK is an opening marker `⟦...⟧` and its matching `⟦end ...⟧` marker; the
  whole span between them (held content included) is removed. Bold wrappers
  (`**⟦...⟧**`) are absorbed.
- A lone marker `⟦...⟧` with no paired end is removed on its own.
- HTML comments `<!-- ... -->` are removed.
"""

from __future__ import annotations

import re

_OPEN = "⟦"
_CLOSE = "⟧"

# Opening marker (not an "end" marker) ... matching ⟦end ...⟧ marker. Non-greedy
# so adjacent blocks don't merge; DOTALL so a block can span paragraphs.
_BLOCK_RE = re.compile(
    rf"\*{{0,2}}{_OPEN}(?!\s*end)[^{_CLOSE}]*{_CLOSE}"
    rf".*?"
    rf"\*{{0,2}}{_OPEN}\s*end[^{_CLOSE}]*{_CLOSE}\*{{0,2}}",
    re.DOTALL | re.IGNORECASE,
)
# Any remaining lone marker (inline note with no paired end).
_MARKER_RE = re.compile(rf"\*{{0,2}}{_OPEN}[^{_CLOSE}]*{_CLOSE}\*{{0,2}}")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def strip_scaffolding(md: str) -> str:
    """Remove editorial/parked blocks (paired and lone `⟦...⟧` markers and HTML
    comments), then collapse the blank-line runs their removal leaves behind."""
    out = _BLOCK_RE.sub("", md)
    out = _MARKER_RE.sub("", out)
    out = _COMMENT_RE.sub("", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()
