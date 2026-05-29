"""Reference-context injection — assembles the "## Reference Materials" block
that gets prepended to outline + section + ideation prompts.

The block is a concatenation of each reference's extracted markdown, with a
small per-doc header (kind + name). Sources are fetched from S3 in parallel.
A global character budget keeps the prompt size predictable; when the total
content would exceed it, each ref is proportionally truncated.
"""
from __future__ import annotations

import asyncio
import logging

from blogforge.drafts.models import Reference
from blogforge.s3 import S3Client, S3Error, get_s3_client

_log = logging.getLogger(__name__)

REFERENCE_BUDGET_CHARS = 30_000
"""Soft cap on the total chars of the assembled reference block.

Chosen so that 9 section calls x 30k chars x ~3 chars/token ~= 80k tokens of
reference context across a draft's lifetime — generous but not absurd. The
v1 spec keeps this conservative; per-call summarisation is a later add."""

_PER_REF_HEADER_OVERHEAD = 80  # chars budgeted for the kind/name header


async def get_reference_context(draft_id: str, refs: list[Reference]) -> str:
    """Build the "## Reference Materials\\n\\n…" block for a draft.

    Returns "" when the draft has no references. Missing S3 objects are
    treated as a soft failure: we log a warning and skip the ref's body
    rather than failing the whole prompt build.
    """
    if not refs:
        return ""

    s3 = get_s3_client()
    bodies = await asyncio.gather(
        *[_fetch_one(s3, draft_id, r) for r in refs],
        return_exceptions=True,
    )

    pairs: list[tuple[Reference, str]] = []
    for ref, body in zip(refs, bodies, strict=True):
        if isinstance(body, BaseException):
            _log.warning(
                "reference %s body fetch failed; skipping body: %s", ref.id, body
            )
            pairs.append((ref, ""))
        else:
            pairs.append((ref, body))

    total = sum(len(b) for _, b in pairs) + len(pairs) * _PER_REF_HEADER_OVERHEAD
    if total <= REFERENCE_BUDGET_CHARS:
        return _format(pairs)

    per_ref_budget = max(
        500,
        (REFERENCE_BUDGET_CHARS - len(pairs) * _PER_REF_HEADER_OVERHEAD) // len(pairs),
    )
    truncated = [
        (ref, _truncate(body, per_ref_budget)) for ref, body in pairs
    ]
    return _format(truncated)


async def _fetch_one(s3: S3Client, draft_id: str, ref: Reference) -> str:
    key = f"drafts/{draft_id}/references/extracted/{ref.id}.md"
    try:
        raw = await s3.get_object(key)
    except S3Error as err:
        raise err  # surfaced into the gather; logged + treated as empty
    decoded: str = raw.decode("utf-8", errors="replace")
    return decoded


def _truncate(body: str, budget: int) -> str:
    if len(body) <= budget:
        return body
    return body[:budget].rstrip() + "\n\n[truncated for prompt budget]"


def _format(pairs: list[tuple[Reference, str]]) -> str:
    out = ["## Reference Materials", ""]
    for ref, body in pairs:
        out.append(f"### [{ref.kind}] {ref.name}")
        out.append("")
        if body:
            out.append(body)
        else:
            out.append("_(content unavailable)_")
        out.append("")
    return "\n".join(out).rstrip() + "\n"
