"""POST /api/drafts/{id}/sections/{section_id}/regenerate
   POST /api/drafts/{id}/sections/{section_id}/save
   POST /api/drafts/{id}/sections/reorder
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import yaml
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from myvoice.compose import ComposeError
from pydantic import BaseModel

from pencraft.api.outline import _read_myvoice_key
from pencraft.drafts import Draft, DraftStore
from pencraft.generate.section import stream_section
from pencraft.jobs.models import JobType
from pencraft.jobs.registry import JobRegistry
from pencraft.llm.exceptions import ProviderError, ProviderMissingKey
from pencraft.llm.registry import get_provider

router = APIRouter(tags=["section"])


class _SaveBody(BaseModel):
    content_md: str


class _ReorderBody(BaseModel):
    section_ids: list[str]


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
def save_section(draft_id: str, section_id: str, body: _SaveBody, request: Request) -> Draft:
    store: DraftStore = request.app.state.draft_store
    draft = store.get(draft_id)
    if draft is None:
        raise _draft_not_found(draft_id)
    section = next((s for s in draft.sections if s.id == section_id), None)
    if section is None:
        raise _section_not_found(section_id)
    section.content_md = body.content_md
    section.status = "edited"
    section.last_error = None
    section.word_count = len(body.content_md.split())
    store.update(draft.id, draft)
    return draft


@router.post("/api/drafts/{draft_id}/sections/reorder")
def reorder_sections(draft_id: str, body: _ReorderBody, request: Request) -> Draft:
    store: DraftStore = request.app.state.draft_store
    draft = store.get(draft_id)
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
    store.update(draft.id, draft)
    return draft


@router.post("/api/drafts/{draft_id}/sections/{section_id}/regenerate", status_code=202)
async def regenerate_section(
    draft_id: str, section_id: str, request: Request, background_tasks: BackgroundTasks,
) -> dict[str, str]:
    store: DraftStore = request.app.state.draft_store
    pack_store = request.app.state.pack_store
    reg: JobRegistry = request.app.state.job_registry

    draft = store.get(draft_id)
    if draft is None:
        raise _draft_not_found(draft_id)
    section = next((s for s in draft.sections if s.id == section_id), None)
    if section is None:
        raise _section_not_found(section_id)

    pack_info = pack_store.get(draft.idea.pack_slug)
    if pack_info is None:
        raise HTTPException(
            404, detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}}
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

    job = await reg.create(JobType.REGEN_SECTION)
    background_tasks.add_task(
        _run_regenerate,
        reg,
        store,
        job.id,
        draft_id,
        section_id,
        pack_info,
        draft.idea.provider,
        api_key,
        draft.idea.model,
    )
    return {"job_id": job.id}


async def _run_regenerate(
    reg: JobRegistry,
    store: DraftStore,
    job_id: str,
    draft_id: str,
    section_id: str,
    pack_info: Any,
    provider_name: str,
    api_key: str,
    model: str,
) -> None:
    cancel_evt = reg.cancellation_event(job_id)
    try:
        draft = store.get(draft_id)
        if draft is None:
            await reg.fail(job_id, "draft_not_found", draft_id)
            return
        section = next((s for s in draft.sections if s.id == section_id), None)
        if section is None:
            await reg.fail(job_id, "section_not_found", section_id)
            return

        manifest = yaml.safe_load(
            (pack_info.root_path / "stylepack.yaml").read_text(encoding="utf-8")
        ) or {}
        provider = get_provider(provider_name, api_key)

        section.status = "generating"
        section.last_error = None
        store.update(draft.id, draft)
        await reg.set_stage(job_id, f"section:start:{section_id}")
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
            await reg.fail(job_id, e.code, e.message, e.hint)
            return
        except ProviderError as e:
            section.status = "failed"
            section.last_error = e.message
            store.update(draft.id, draft)
            await reg.fail(job_id, e.code, e.message, e.hint)
            return
        except ComposeError as e:
            section.status = "failed"
            section.last_error = str(e)
            store.update(draft.id, draft)
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
        store.update(draft.id, draft)
        await reg.set_stage(job_id, f"section:done:{section_id}")
        await reg.complete(job_id, {"section_id": section_id, "word_count": section.word_count})
    except Exception as e:
        await reg.fail(job_id, "internal_error", f"Unexpected: {e}")
