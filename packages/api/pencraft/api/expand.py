"""POST /api/drafts/{id}/expand — async pipeline expanding all sections."""
from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from myvoice.compose import ComposeError

from pencraft.auth.dependencies import get_current_user
from pencraft.db.models import User
from pencraft.drafts.sql_store import SqlDraftStore
from pencraft.generate.references import get_reference_context
from pencraft.generate.section import stream_section
from pencraft.jobs.models import JobType
from pencraft.jobs.registry import JobRegistry
from pencraft.keys import KeyVault
from pencraft.llm.exceptions import ProviderError, ProviderMissingKey
from pencraft.llm.registry import get_provider

router = APIRouter(tags=["expand"])

_CONCURRENCY = 2


@router.post("/api/drafts/{draft_id}/expand", status_code=202)
async def expand_draft(
    draft_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store
    reg: JobRegistry = request.app.state.job_registry

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})
    if draft.outline is None:
        raise HTTPException(
            409,
            detail={
                "error": {
                    "code": "invalid_stage",
                    "message": "Outline must exist before expanding.",
                }
            },
        )
    # Defensive backfill: if the outline exists but the sections list is empty
    # (e.g. drafts created by an older ideation/accept that didn't seed sections),
    # synthesize the section shells now from outline.sections and persist.
    if not draft.sections:
        from pencraft.drafts.models import Section

        draft.sections = [
            Section(id=s.id, title=s.title, brief=s.brief)
            for s in draft.outline.sections
        ]
        await store.update(draft.id, draft, user_id=current.id)

    pack_info = pack_store.get(draft.idea.pack_slug)
    if pack_info is None:
        raise HTTPException(
            404,
            detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}},
        )

    api_key = await KeyVault().get(draft.idea.provider)
    if not api_key:
        raise HTTPException(
            400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": f"No API key for {draft.idea.provider}",
                    "hint": "An admin can add one under /admin (API keys section).",
                }
            },
        )

    job = await reg.create(JobType.EXPAND)
    background_tasks.add_task(
        _run_expand,
        reg,
        store,
        job.id,
        draft_id,
        pack_info,
        draft.idea.provider,
        api_key,
        draft.idea.model,
        current.id,
    )
    return {"job_id": job.id}


async def _run_expand(
    reg: JobRegistry,
    store: SqlDraftStore,
    job_id: str,
    draft_id: str,
    pack_info: Any,
    provider_name: str,
    api_key: str,
    model: str,
    user_id: UUID,
) -> None:
    cancel_evt = reg.cancellation_event(job_id)
    started = time.monotonic()
    try:
        draft = await store.get(draft_id, user_id=user_id)
        if draft is None:
            await reg.fail(job_id, "draft_not_found", f"Draft {draft_id} gone")
            return

        manifest = yaml.safe_load(
            (pack_info.root_path / "stylepack.yaml").read_text(encoding="utf-8")
        ) or {}
        provider = get_provider(provider_name, api_key)
        # Build reference context once per expand job (every section in this
        # draft sees the same materials), not per-section.
        reference_context = await get_reference_context(draft.id, draft.references)
        semaphore = asyncio.Semaphore(_CONCURRENCY)

        # Captured per-section failures. Inner expand_one no longer calls
        # reg.fail directly — the outer code decides whether the whole job
        # failed (every target failed) or succeeded (some sections produced).
        section_errors: list[tuple[str, str, str | None]] = []

        async def expand_one(idx: int) -> None:
            section = draft.sections[idx]
            if cancel_evt.is_set():
                return
            # Skip only sections that have real content — empty "edited" sections
            # (saved while blank) should still be retried by a bulk expand.
            if section.content_md.strip() and section.status in ("ready", "edited"):
                return
            async with semaphore:
                if cancel_evt.is_set():
                    return
                section.status = "generating"
                section.last_error = None
                await store.update(draft.id, draft, user_id=user_id)
                await reg.set_stage(job_id, f"section:start:{section.id}")
                buf = ""
                try:
                    async for chunk in stream_section(
                        draft,
                        section,
                        pack_info.root_path,
                        manifest,
                        provider,
                        model=model,
                        reference_context=reference_context,
                    ):
                        if cancel_evt.is_set():
                            section.status = "failed"
                            section.last_error = "Cancelled before completion."
                            await store.update(draft.id, draft, user_id=user_id)
                            return
                        if chunk.delta:
                            buf += chunk.delta
                except ProviderMissingKey as e:
                    section.status = "failed"
                    section.last_error = e.message
                    await store.update(draft.id, draft, user_id=user_id)
                    section_errors.append((e.code, e.message, e.hint))
                    return
                except ProviderError as e:
                    section.status = "failed"
                    section.last_error = e.message
                    await store.update(draft.id, draft, user_id=user_id)
                    section_errors.append((e.code, e.message, e.hint))
                    return
                except ComposeError as e:
                    section.status = "failed"
                    section.last_error = str(e)
                    await store.update(draft.id, draft, user_id=user_id)
                    section_errors.append(
                        (
                            "compose_error",
                            str(e),
                            "Check the draft's format/samples against the pack manifest.",
                        )
                    )
                    return
                section.content_md = buf.strip() + "\n"
                section.word_count = len(buf.split())
                section.status = "ready"
                section.last_error = None
                section.last_generated_at = datetime.now(UTC)
                await store.update(draft.id, draft, user_id=user_id)
                await reg.set_stage(job_id, f"section:done:{section.id}")

        targets = [
            i
            for i, s in enumerate(draft.sections)
            if not (s.content_md.strip() and s.status in ("ready", "edited"))
        ]
        await asyncio.gather(*[expand_one(i) for i in targets])
        if cancel_evt.is_set():
            return
        # Persist final stage
        draft.stage = "sections"
        await store.update(draft.id, draft, user_id=user_id)
        elapsed = time.monotonic() - started
        done = sum(1 for s in draft.sections if s.status == "ready")
        failed = sum(1 for s in draft.sections if s.status == "failed")
        # If every target failed, surface that as a job-level failure with the
        # FIRST per-section error's actual message (so the user sees what's
        # wrong: missing key, bad format, etc.) instead of a generic "all failed".
        if targets and done == 0 and section_errors:
            code, message, hint = section_errors[0]
            await reg.fail(job_id, code, message, hint)
            return
        await reg.complete(
            job_id,
            {
                "draft_id": draft.id,
                "sections_done": done,
                "sections_failed": failed,
                "elapsed_seconds": elapsed,
            },
        )
    except Exception as e:
        await reg.fail(job_id, "internal_error", f"Unexpected: {e}")
