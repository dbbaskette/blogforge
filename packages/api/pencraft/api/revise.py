"""POST /api/drafts/{id}/revise — holistic, whole-draft revision.

Unlike single-section regenerate, this walks every already-written section
in document order and rewrites each one against a single author instruction
("tighten throughout", "smooth the transitions", "make the tone more
casual"), giving each section the *current* full draft as context so the
pass stays coherent across sections. Each section's prior prose is
snapshotted into version history first, so the whole pass is revertible
section by section.
"""
from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from myvoice.compose import ComposeError
from pydantic import BaseModel, Field

from pencraft.auth.dependencies import get_current_user
from pencraft.db.models import User
from pencraft.drafts.models import Draft
from pencraft.drafts.sql_store import SqlDraftStore
from pencraft.generate.references import get_reference_context
from pencraft.generate.section import stream_section
from pencraft.jobs.models import JobType
from pencraft.jobs.registry import JobRegistry
from pencraft.keys import KeyVault
from pencraft.llm.exceptions import ProviderError, ProviderMissingKey
from pencraft.llm.registry import get_provider

router = APIRouter(tags=["revise"])


class _ReviseBody(BaseModel):
    instruction: str = Field(min_length=1)


def _has_written_section(draft: Draft) -> bool:
    return any(
        s.content_md.strip() and s.status in ("ready", "edited") for s in draft.sections
    )


def _revise_context(draft: Draft, base: str) -> str:
    """Append the current full draft to any reference context so each
    section is revised with awareness of its neighbours."""
    full = SqlDraftStore.assemble_markdown(draft)
    block = (
        "## Full Draft (for coherence)\n\n"
        "Below is the complete current draft. Revise ONLY the target section "
        "named in the prompt, keeping it consistent with the surrounding "
        "sections — tone, terminology, and transitions. Do not restate or "
        "duplicate the other sections.\n\n"
        f"{full}"
    )
    return f"{base}\n\n{block}" if base.strip() else block


@router.post("/api/drafts/{draft_id}/revise", status_code=202)
async def revise_draft(
    draft_id: str,
    body: _ReviseBody,
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
    if not _has_written_section(draft):
        raise HTTPException(
            409,
            detail={
                "error": {
                    "code": "nothing_to_revise",
                    "message": "Write at least one section before revising the whole draft.",
                }
            },
        )

    pack_info = pack_store.get(draft.idea.pack_slug)
    if pack_info is None:
        raise HTTPException(
            404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
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

    job = await reg.create(JobType.REVISE_DRAFT, draft_id=draft_id)
    background_tasks.add_task(
        _run_revise,
        reg,
        store,
        job.id,
        draft_id,
        pack_info,
        draft.idea.provider,
        api_key,
        draft.idea.model,
        current.id,
        body.instruction,
    )
    return {"job_id": job.id}


async def _run_revise(
    reg: JobRegistry,
    store: SqlDraftStore,
    job_id: str,
    draft_id: str,
    pack_info: Any,
    provider_name: str,
    api_key: str,
    model: str,
    user_id: UUID,
    instruction: str,
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
        base_ref = await get_reference_context(draft.id, draft.references)

        # Document order; only sections that already hold prose.
        targets = [
            i
            for i, s in enumerate(draft.sections)
            if s.content_md.strip() and s.status in ("ready", "edited")
        ]
        section_errors: list[tuple[str, str, str | None]] = []
        revised = 0

        for idx in targets:
            if cancel_evt.is_set():
                break
            section = draft.sections[idx]
            # Snapshot the prior prose so the whole pass is revertible.
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
                    reference_context=_revise_context(draft, base_ref),
                    instruction=instruction,
                ):
                    if cancel_evt.is_set():
                        section.status = "failed"
                        section.last_error = "Cancelled before completion."
                        await store.update(draft.id, draft, user_id=user_id)
                        break
                    if chunk.delta:
                        buf += chunk.delta
            except (ProviderMissingKey, ProviderError) as e:
                section.status = "failed"
                section.last_error = e.message
                await store.update(draft.id, draft, user_id=user_id)
                section_errors.append((e.code, e.message, e.hint))
                continue
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
                continue
            if cancel_evt.is_set():
                break
            section.content_md = buf.strip() + "\n"
            section.word_count = len(buf.split())
            section.status = "ready"
            section.last_error = None
            section.last_generated_at = datetime.now(UTC)
            await store.update(draft.id, draft, user_id=user_id)
            await reg.set_stage(job_id, f"section:done:{section.id}")
            revised += 1

        if cancel_evt.is_set():
            return
        # Every target failed → surface the first real error.
        if targets and revised == 0 and section_errors:
            code, message, hint = section_errors[0]
            await reg.fail(job_id, code, message, hint)
            return
        elapsed = time.monotonic() - started
        await reg.complete(
            job_id,
            {
                "draft_id": draft.id,
                "sections_revised": revised,
                "sections_failed": len(section_errors),
                "elapsed_seconds": elapsed,
            },
        )
    except Exception as e:
        await reg.fail(job_id, "internal_error", f"Unexpected: {e}")
