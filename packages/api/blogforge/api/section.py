"""POST /api/drafts/{id}/sections/{section_id}/regenerate
   POST /api/drafts/{id}/sections/{section_id}/save
   POST /api/drafts/{id}/sections/reorder
"""
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from blogforge.voice.compose import ComposeError
from pydantic import BaseModel

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import User
from blogforge.drafts.models import Draft, SectionVersion
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.references import get_reference_context
from blogforge.generate.section import stream_section
from blogforge.jobs.models import JobType
from blogforge.jobs.registry import JobRegistry
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.resolve import build_provider_for
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["section"])


class _SaveBody(BaseModel):
    content_md: str


class _ReorderBody(BaseModel):
    section_ids: list[str]


class _RegenerateBody(BaseModel):
    """Optional author note steering the regeneration ("tighten this",
    "add a concrete example", "less formal"). Empty/absent = plain regen."""

    instruction: str = ""


def _section_not_found(section_id: str) -> HTTPException:
    return HTTPException(
        404,
        detail={"error": {"code": "section_not_found", "message": f"No section '{section_id}'"}},
    )


def _draft_not_found(draft_id: str) -> HTTPException:
    return HTTPException(
        404,
        detail={"error": {"code": "draft_not_found", "message": f"No draft '{draft_id}'"}},
    )


@router.post("/api/drafts/{draft_id}/sections/{section_id}/save")
async def save_section(
    draft_id: str,
    section_id: str,
    body: _SaveBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _draft_not_found(draft_id)
    section = next((s for s in draft.sections if s.id == section_id), None)
    if section is None:
        raise _section_not_found(section_id)
    # Snapshot the prior content so a manual edit can be undone.
    await store.add_section_version(
        draft.id,
        section_id,
        user_id=current.id,
        title=section.title,
        content_md=section.content_md,
        word_count=section.word_count,
        status=section.status,
        source="save",
    )
    section.content_md = body.content_md
    section.status = "edited"
    section.last_error = None
    section.word_count = len(body.content_md.split())
    updated = await store.update(draft.id, draft, user_id=current.id)
    return updated if updated is not None else draft


@router.post("/api/drafts/{draft_id}/sections/reorder")
async def reorder_sections(
    draft_id: str,
    body: _ReorderBody,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _draft_not_found(draft_id)
    by_id = {s.id: s for s in draft.sections}
    if set(body.section_ids) != set(by_id.keys()):
        raise HTTPException(
            422,
            detail={
                "error": {
                    "code": "invalid_reorder",
                    "message": "section_ids must be a permutation of existing section ids.",
                }
            },
        )
    draft.sections = [by_id[sid] for sid in body.section_ids]
    # Also reorder outline if present
    if draft.outline:
        ol_by_id = {s.id: s for s in draft.outline.sections}
        draft.outline.sections = [ol_by_id[sid] for sid in body.section_ids]
    updated = await store.update(draft.id, draft, user_id=current.id)
    return updated if updated is not None else draft


@router.post("/api/drafts/{draft_id}/sections/{section_id}/regenerate", status_code=202)
async def regenerate_section(
    draft_id: str,
    section_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    body: _RegenerateBody | None = None,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    store: SqlDraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store
    reg: JobRegistry = request.app.state.job_registry

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _draft_not_found(draft_id)
    section = next((s for s in draft.sections if s.id == section_id), None)
    if section is None:
        raise _section_not_found(section_id)

    if not draft.idea.use_voice_profile:
        pack_info = pack_store.get(draft.idea.pack_slug)
        if pack_info is None:
            raise HTTPException(
                404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
            )

    pack_root = await resolve_voice(
        draft, current.id, pack_store=pack_store
    )

    job = await reg.create(JobType.REGEN_SECTION, draft_id=draft_id)
    background_tasks.add_task(
        _run_regenerate,
        reg,
        store,
        job.id,
        draft_id,
        section_id,
        pack_root,
        draft.idea.provider,
        draft.idea.model,
        current.id,
        body.instruction if body else "",
    )
    return {"job_id": job.id}


@router.get("/api/drafts/{draft_id}/sections/{section_id}/versions")
async def list_section_versions(
    draft_id: str,
    section_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> list[SectionVersion]:
    store: SqlDraftStore = request.app.state.draft_store
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _draft_not_found(draft_id)
    if not any(s.id == section_id for s in draft.sections):
        raise _section_not_found(section_id)
    return await store.list_section_versions(draft_id, section_id, user_id=current.id)


@router.post("/api/drafts/{draft_id}/sections/{section_id}/versions/{version_id}/revert")
async def revert_section_version(
    draft_id: str,
    section_id: str,
    version_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    store: SqlDraftStore = request.app.state.draft_store
    reverted = await store.revert_section(
        draft_id, section_id, version_id, user_id=current.id
    )
    if reverted is None:
        raise HTTPException(
            404,
            detail={
                "error": {
                    "code": "version_not_found",
                    "message": f"No version '{version_id}' for section '{section_id}'",
                }
            },
        )
    return reverted


async def _run_regenerate(
    reg: JobRegistry,
    store: SqlDraftStore,
    job_id: str,
    draft_id: str,
    section_id: str,
    pack_root: Path,
    provider_name: str,
    model: str,
    user_id: UUID,
    instruction: str = "",
) -> None:
    cancel_evt = reg.cancellation_event(job_id)
    draft = None
    section = None
    try:
        draft = await store.get(draft_id, user_id=user_id)
        if draft is None:
            await reg.fail(job_id, "draft_not_found", draft_id)
            return
        section = next((s for s in draft.sections if s.id == section_id), None)
        if section is None:
            await reg.fail(job_id, "section_not_found", section_id)
            return

        manifest = yaml.safe_load(
            (pack_root / "stylepack.yaml").read_text(encoding="utf-8")
        ) or {}
        provider = await build_provider_for(user_id, provider_name)

        # Snapshot the prior content before it's overwritten so the author
        # can compare against — or revert to — the pre-regeneration version.
        await store.add_section_version(
            draft.id,
            section_id,
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
        await reg.set_stage(job_id, f"section:start:{section_id}")
        reference_context = await get_reference_context(draft.id, draft.references)
        buf = ""
        try:
            async for chunk in stream_section(
                draft,
                section,
                pack_root,
                manifest,
                provider,
                model=model,
                reference_context=reference_context,
                instruction=instruction,
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
            await reg.fail(job_id, e.code, e.message, e.hint)
            return
        except ProviderError as e:
            section.status = "failed"
            section.last_error = e.message
            await store.update(draft.id, draft, user_id=user_id)
            await reg.fail(job_id, e.code, e.message, e.hint)
            return
        except ComposeError as e:
            section.status = "failed"
            section.last_error = str(e)
            await store.update(draft.id, draft, user_id=user_id)
            await reg.fail(
                job_id,
                "compose_error",
                str(e),
                "Check the draft's format/samples against the pack manifest.",
            )
            return
        section.content_md = buf.strip() + "\n"
        section.word_count = len(buf.split())
        section.status = "ready"
        section.last_error = None
        section.last_generated_at = datetime.now(UTC)
        await store.update(draft.id, draft, user_id=user_id)
        await reg.set_stage(job_id, f"section:done:{section_id}")
        await reg.complete(job_id, {"section_id": section_id, "word_count": section.word_count})
    except Exception as e:
        await reg.fail(job_id, "internal_error", f"Unexpected: {e}")
    finally:
        # Never leave a section stranded as "generating" (unexpected error,
        # cancellation, or a dropped task) — the UI would show "Composing…"
        # forever. Mark it failed so the author gets a retry. Best-effort; the
        # boot-time recover_stranded_sections() is the backstop.
        if section is not None and section.status == "generating":
            section.status = "failed"
            section.last_error = (
                section.last_error
                or "Generation was interrupted before it finished — please retry."
            )
            try:
                await store.update(draft.id, draft, user_id=user_id)
            except Exception:
                pass
