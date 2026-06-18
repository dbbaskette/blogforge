"""Build a "## Background sources" block from a user's ready voice sources.

Loaded at generation time and prepended to the reference_context so the model
has factual grounding from the user's context URLs (e.g. product docs).

Sources are NEVER used for style distillation — they live in voice_sources,
not voice_samples.
"""
from __future__ import annotations

import logging
from uuid import UUID

from blogforge.s3 import get_s3_client
from blogforge.voice.store import SqlVoiceStore

logger = logging.getLogger(__name__)

_PER_SOURCE_LIMIT = 4_000   # chars per individual source
_TOTAL_LIMIT = 16_000       # chars for the whole background block (excl. headers)

_HEADER = (
    "## Background sources\n"
    "These are factual reference materials for this author's voice; "
    "draw on them for facts/terminology, not style.\n"
)


async def build_background_context(user_id: UUID) -> str:
    """Return a formatted "## Background sources" block, or "" if none ready.

    Never raises — S3 read errors are logged and the source is skipped.
    """
    store = SqlVoiceStore()
    sources = await store.list_sources(user_id)
    ready = [s for s in sources if s.status == "ready"]
    if not ready:
        return ""

    s3 = get_s3_client()
    sections: list[str] = []
    total_chars = 0

    for source in ready:
        if total_chars >= _TOTAL_LIMIT:
            break
        try:
            raw = await s3.get_object(source.s3_key)
            content = raw.decode("utf-8", errors="replace")
        except Exception as exc:
            logger.warning(
                "build_background_context: skipping source %s (%r): %s",
                source.id,
                source.s3_key,
                exc,
            )
            continue

        # Truncate per-source
        if len(content) > _PER_SOURCE_LIMIT:
            content = content[:_PER_SOURCE_LIMIT]

        # Respect total budget
        remaining = _TOTAL_LIMIT - total_chars
        if len(content) > remaining:
            content = content[:remaining]

        label = source.name or source.url
        sections.append(f"### {label}\n{content}")
        total_chars += len(content)

    if not sections:
        return ""

    return _HEADER + "\n\n".join(sections)
