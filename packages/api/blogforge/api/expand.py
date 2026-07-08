"""POST /api/drafts/{id}/expand — async pipeline expanding all sections."""
from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from blogforge.voice.compose import ComposeError

from blogforge.auth.dependencies import get_current_user
from blogforge.config import get_settings
from blogforge.db.models import User
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.document import generate_document, split_document
from blogforge.generate.references import get_reference_context
from blogforge.jobs.models import JobType
from blogforge.jobs.registry import JobRegistry
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.resolve import build_provider_for
from blogforge.voice.enforce import enforce_voice_rules
from blogforge.voice.packs.manifest import Manifest
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["expand"])


@router.post("/api/drafts/{draft_id}/expand", status_code=202)
async def expand_draft(
    draft_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    limit: int | None = None,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    """Compose the draft's unwritten sections. `?limit=N` composes only the
    next N unwritten sections in document order (incremental drafting)."""
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
    # Entering the drafting stage. Two things happen here, synchronously, BEFORE
    # the async compose job starts, so the UI can switch to the live composing
    # view immediately instead of leaving the writer on a frozen outline:
    #   1. Backfill section shells if the outline exists but sections are empty
    #      (older ideation/accept flows didn't seed them).
    #   2. Advance the stage to "sections" now. (_run_expand also sets it at the
    #      end; moving it up is what lets the frontend show per-section progress
    #      the moment compose starts.)
    persist = False
    if not draft.sections:
        from blogforge.drafts.models import Section

        draft.sections = [
            Section(id=s.id, title=s.title, brief=s.brief)
            for s in draft.outline.sections
        ]
        persist = True
    if draft.stage != "sections":
        draft.stage = "sections"
        persist = True
    if persist:
        await store.update(draft.id, draft, user_id=current.id)

    if not draft.idea.use_voice_profile:
        pack_info = pack_store.get(draft.idea.pack_slug)
        if pack_info is None:
            raise HTTPException(
                404,
                detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}},
            )

    pack_root = await resolve_voice(
        draft, current.id, pack_store=pack_store
    )

    job = await reg.create(JobType.EXPAND, draft_id=draft_id)
    background_tasks.add_task(
        _run_expand,
        reg,
        store,
        job.id,
        draft_id,
        pack_root,
        draft.idea.provider,
        draft.idea.model,
        current.id,
        limit,
    )
    return {"job_id": job.id}


async def _run_expand(
    reg: JobRegistry,
    store: SqlDraftStore,
    job_id: str,
    draft_id: str,
    pack_root: Path,
    provider_name: str,
    model: str,
    user_id: UUID,
    limit: int | None = None,
) -> None:
    cancel_evt = reg.cancellation_event(job_id)
    started = time.monotonic()
    draft = None
    try:
        draft = await store.get(draft_id, user_id=user_id)
        if draft is None:
            await reg.fail(job_id, "draft_not_found", f"Draft {draft_id} gone")
            return

        manifest = yaml.safe_load(
            (pack_root / "stylepack.yaml").read_text(encoding="utf-8")
        ) or {}
        provider = await build_provider_for(user_id, provider_name)
        # Build reference context once per expand job (every section in this
        # draft sees the same materials), not per-section.
        reference_context = await get_reference_context(draft.id, draft.references)

        # Prepend profile-level background sources (facts/terminology, not style).
        from blogforge.voice.sources_context import build_background_context
        bg = await build_background_context(user_id)
        if bg:
            reference_context = f"{bg}\n\n{reference_context}" if reference_context else bg

        async def _fail_all(message: str) -> None:
            for s in draft.sections:
                s.status = "failed"
                s.last_error = message
            await store.update(draft.id, draft, user_id=user_id)

        # Single-pass: compose the ENTIRE post in one LLM call from the outline.
        # `limit` is accepted for API compatibility but ignored — single-pass
        # always writes the whole draft (the model holds the full argument at
        # once, which is what stops it restating itself section by section).

        # Snapshot any existing prose so a full re-compose stays revertible.
        for section in draft.sections:
            if section.content_md.strip():
                await store.add_section_version(
                    draft.id,
                    section.id,
                    user_id=user_id,
                    title=section.title,
                    content_md=section.content_md,
                    word_count=section.word_count,
                    status=section.status,
                    source="regenerate",
                )

        # Mark every section composing up front (one pass fills them all).
        for section in draft.sections:
            section.status = "generating"
            section.last_error = None
        await store.update(draft.id, draft, user_id=user_id)
        for section in draft.sections:
            await reg.set_stage(job_id, f"section:start:{section.id}")

        try:
            document = await generate_document(
                draft,
                pack_root,
                manifest,
                provider,
                model=model,
                reference_context=reference_context,
            )
        except (ProviderMissingKey, ProviderError) as e:
            await _fail_all(e.message)
            await reg.fail(job_id, e.code, e.message, e.hint)
            return
        except ComposeError as e:
            await _fail_all(str(e))
            await reg.fail(
                job_id,
                "compose_error",
                str(e),
                "Check the draft's format/samples against the pack manifest.",
            )
            return

        if cancel_evt.is_set():
            return

        # Split the one document back onto the section model by H2 heading.
        by_id = split_document(document, draft.sections)
        now = datetime.now(UTC)
        # Enforce the mechanical voice rules the model may have ignored (em/en
        # dashes, ASCII `--`, banished words): detect → model repair → backstop.
        # The repairs are independent per section, so run them CONCURRENTLY
        # (bounded) instead of serially — the repair LLM round-trips were the
        # longest sequential stretch of the compose job.
        enforce_on = get_settings().enforce_voice_rules
        mf = Manifest.model_validate(manifest) if enforce_on else None

        sem = asyncio.Semaphore(4)

        async def _enforce(body: str) -> str:
            if mf is None:
                return body
            async with sem:
                return (await enforce_voice_rules(body, mf, provider, model)).strip()

        bodies = {s.id: (by_id.get(s.id) or "").strip() for s in draft.sections}
        enforced = await asyncio.gather(
            *(_enforce(bodies[s.id]) for s in draft.sections if bodies[s.id])
        )
        enforced_by_id = dict(zip([s.id for s in draft.sections if bodies[s.id]], enforced))

        for section in draft.sections:
            body = enforced_by_id.get(section.id, "")
            if body:
                section.content_md = body + "\n"
                section.word_count = len(body.split())
                section.status = "ready"
                section.last_error = None
                section.last_generated_at = now
            else:
                section.status = "failed"
                section.last_error = "No content mapped to this section from the single-pass draft."
            await reg.set_stage(job_id, f"section:done:{section.id}")

        draft.stage = "sections"
        await store.update(draft.id, draft, user_id=user_id)

        elapsed = time.monotonic() - started
        done = sum(1 for s in draft.sections if s.status == "ready")
        failed = sum(1 for s in draft.sections if s.status == "failed")
        if done == 0:
            await reg.fail(
                job_id,
                "empty_generation",
                "The single-pass draft produced no usable sections.",
                "Try composing again, or check that the outline has section titles.",
            )
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
    finally:
        # Don't leave any section stranded as "generating" (unexpected error or
        # cancellation mid-pass) — the UI would show "Composing…" forever.
        # Best-effort; boot-time recover_stranded_sections() is the backstop.
        if draft is not None:
            stranded = [s for s in draft.sections if s.status == "generating"]
            if stranded:
                for s in stranded:
                    s.status = "failed"
                    s.last_error = s.last_error or (
                        "Generation was interrupted before it finished — please retry."
                    )
                try:
                    await store.update(draft.id, draft, user_id=user_id)
                except Exception:
                    pass
