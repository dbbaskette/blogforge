"""Self-heal sections stranded mid-generation.

A section is flipped to ``status="generating"`` while a compose/regenerate job
runs. If that job dies — an unexpected error, an SSE client disconnect, or a
server restart — the section is left stranded and the UI shows
"Composing this section…" forever with nothing happening.

No generation can survive a process restart, so on boot every ``"generating"``
section is stale. Recover each: if it still holds prose, keep it
(``status="ready"``); otherwise mark it ``"failed"`` so the UI offers a retry.
This runs once in the FastAPI lifespan, after migrations.
"""
from __future__ import annotations

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from blogforge.db.models import Section

INTERRUPTED_MESSAGE = (
    "Generation was interrupted before it finished — please retry."
)


async def recover_stranded_sections(session: AsyncSession) -> int:
    """Reset sections stuck in ``"generating"``. Returns how many were reset.

    Content-bearing sections become ``"ready"`` (the prior prose is preserved);
    empty ones become ``"failed"`` with a retry-able error message.
    """
    kept = await session.execute(
        update(Section)
        .where(Section.status == "generating")
        .where(func.length(func.trim(Section.content_md)) > 0)
        .values(status="ready", last_error=None)
    )
    failed = await session.execute(
        update(Section)
        .where(Section.status == "generating")
        .values(status="failed", last_error=INTERRUPTED_MESSAGE)
    )
    await session.commit()
    return (kept.rowcount or 0) + (failed.rowcount or 0)
