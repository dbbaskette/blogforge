"""POST /api/drafts/{id}/expand — async pipeline expanding all sections."""
from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from typing import Any

import yaml
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from myvoice.compose import ComposeError

from pencraft.api.outline import _read_myvoice_key
from pencraft.drafts import DraftStore
from pencraft.generate.section import stream_section
from pencraft.jobs.models import JobType
from pencraft.jobs.registry import JobRegistry
from pencraft.llm.exceptions import ProviderError, ProviderMissingKey
from pencraft.llm.registry import get_provider

router = APIRouter(tags=["expand"])

_CONCURRENCY = 2


@router.post("/api/drafts/{draft_id}/expand", status_code=202)
async def expand_draft(
    draft_id: str, request: Request, background_tasks: BackgroundTasks,
) -> dict[str, str]:
    store: DraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store
    reg: JobRegistry = request.app.state.job_registry

    draft = store.get(draft_id)
    if draft is None:
        raise HTTPException(404, detail={"error": {"code": "draft_not_found", "message": draft_id}})
    if draft.outline is None or not draft.sections:
        raise HTTPException(
            409,
            detail={
                "error": {
                    "code": "invalid_stage",
                    "message": "Outline must exist before expanding.",
                }
            },
        )

    pack_info = pack_store.get(draft.idea.pack_slug)
    if pack_info is None:
        raise HTTPException(
            404,
            detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}},
        )

    api_key = _read_myvoice_key(draft.idea.provider)
    if not api_key:
        raise HTTPException(
            400,
            detail={
                "error": {
                    "code": "provider_missing_key",
                    "message": f"No API key for {draft.idea.provider}",
                    "hint": "Add the key in myvoice Settings.",
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
    )
    return {"job_id": job.id}


async def _run_expand(
    reg: JobRegistry,
    store: DraftStore,
    job_id: str,
    draft_id: str,
    pack_info: Any,
    provider_name: str,
    api_key: str,
    model: str,
) -> None:
    cancel_evt = reg.cancellation_event(job_id)
    started = time.monotonic()
    try:
        draft = store.get(draft_id)
        if draft is None:
            await reg.fail(job_id, "draft_not_found", f"Draft {draft_id} gone")
            return

        manifest = yaml.safe_load(
            (pack_info.root_path / "stylepack.yaml").read_text(encoding="utf-8")
        ) or {}
        provider = get_provider(provider_name, api_key)
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
                store.update(draft.id, draft)
                await reg.set_stage(job_id, f"section:start:{section.id}")
                buf = ""
                try:
                    async for chunk in stream_section(
                        draft, section, pack_info.root_path, manifest, provider, model=model
                    ):
                        if cancel_evt.is_set():
                            section.status = "failed"
                            section.last_error = "Cancelled before completion."
                            store.update(draft.id, draft)
                            return
                        if chunk.delta:
                            buf += chunk.delta
                except ProviderMissingKey as e:
                    section.status = "failed"
                    section.last_error = e.message
                    store.update(draft.id, draft)
                    section_errors.append((e.code, e.message, e.hint))
                    return
                except ProviderError as e:
                    section.status = "failed"
                    section.last_error = e.message
                    store.update(draft.id, draft)
                    section_errors.append((e.code, e.message, e.hint))
                    return
                except ComposeError as e:
                    section.status = "failed"
                    section.last_error = str(e)
                    store.update(draft.id, draft)
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
                store.update(draft.id, draft)
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
        store.update(draft.id, draft)
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
