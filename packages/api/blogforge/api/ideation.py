"""Ideation endpoints: POST /message (SSE), POST /accept, GET / (history).

The streaming flow rides the existing JobRegistry + /api/jobs/{id}/events
SSE plumbing: POST /message creates a job, the BG task feeds deltas via
reg.append_token, then persists the assistant message on completion.
"""
from __future__ import annotations

import asyncio
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from blogforge.auth.dependencies import get_current_user
from blogforge.db.models import IdeationMessage as IdeationMessageRow
from blogforge.db.models import User
from blogforge.drafts.models import Draft, IdeationMessage, OutlineProposal
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.generate.ideation import stream_ideation
from blogforge.generate.references import get_reference_context
from blogforge.jobs.models import JobType
from blogforge.jobs.registry import JobRegistry
from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.resolve import build_provider_for
from blogforge.voice.resolve import resolve_voice

router = APIRouter(tags=["ideation"])

# Per-process registry of drafts with an in-flight ideation job. The set is
# guarded by a lock to make claim/release atomic; populated by /message,
# drained by the BG task on success or failure.
_in_flight: set[str] = set()
_in_flight_lock = asyncio.Lock()


class _MessageBody(BaseModel):
    content: str = Field(min_length=1, max_length=10_000)
    # "ideate" (default): collaborative, author-led. "interview": AI-led, asks
    # one question at a time and proposes an outline only once it has enough.
    mode: Literal["ideate", "interview"] = "ideate"


async def _try_claim(draft_id: str) -> bool:
    async with _in_flight_lock:
        if draft_id in _in_flight:
            return False
        _in_flight.add(draft_id)
        return True


async def _release(draft_id: str) -> None:
    async with _in_flight_lock:
        _in_flight.discard(draft_id)


def _store(request: Request) -> SqlDraftStore:
    store: SqlDraftStore = request.app.state.draft_store
    return store


def _draft_not_found(draft_id: str) -> HTTPException:
    return HTTPException(
        404,
        detail={"error": {"code": "draft_not_found", "message": f"No draft '{draft_id}'"}},
    )


@router.get("/api/drafts/{draft_id}/ideation", response_model=list[IdeationMessage])
async def get_ideation_history(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> list[IdeationMessage]:
    draft = await _store(request).get(draft_id, user_id=current.id)
    if draft is None:
        raise _draft_not_found(draft_id)
    return draft.ideation_messages


@router.post(
    "/api/drafts/{draft_id}/ideation/message",
    status_code=status.HTTP_202_ACCEPTED,
)
async def post_ideation_message(
    draft_id: str,
    body: _MessageBody,
    request: Request,
    background_tasks: BackgroundTasks,
    current: User = Depends(get_current_user),
) -> dict[str, str]:
    store = _store(request)
    pack_store = request.app.state.pack_store
    reg: JobRegistry = request.app.state.job_registry

    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _draft_not_found(draft_id)

    if not draft.idea.use_voice_profile:
        pack_info = pack_store.get(draft.idea.pack_slug)
        if pack_info is None:
            raise HTTPException(
                404,
                detail={"error": {"code": "pack_not_found", "message": draft.idea.pack_slug}},
            )

    pack_root = await resolve_voice(draft, current.id, pack_store=pack_store)

    if not await _try_claim(draft_id):
        raise HTTPException(
            409,
            detail={
                "error": {
                    "code": "ideation_in_progress",
                    "message": "Another ideation message is still streaming for this draft.",
                }
            },
        )

    # Persist the user's message immediately so the history endpoint shows it
    # the moment the FE refetches.
    next_pos = len(draft.ideation_messages)
    user_msg = IdeationMessageRow(
        id=f"msg-{secrets.token_hex(6)}",
        draft_id=UUID(draft.id),
        position=next_pos,
        role="user",
        content=body.content,
    )
    from blogforge.db.engine import get_sessionmaker

    async with get_sessionmaker()() as session:
        session.add(user_msg)
        await session.commit()

    job = await reg.create(JobType.IDEATION)
    background_tasks.add_task(
        _run_ideation,
        reg,
        store,
        job.id,
        draft_id,
        body.content,
        pack_root,
        draft.idea.provider,
        draft.idea.model,
        current.id,
        next_pos + 1,  # assistant message position
        body.mode,
    )
    return {"job_id": job.id}


async def _run_ideation(
    reg: JobRegistry,
    store: SqlDraftStore,
    job_id: str,
    draft_id: str,
    new_user_content: str,
    pack_root: Path,
    provider_name: str,
    model: str,
    user_id: UUID,
    assistant_position: int,
    mode: str = "ideate",
) -> None:
    cancel_evt = reg.cancellation_event(job_id)
    try:
        draft = await store.get(draft_id, user_id=user_id)
        if draft is None:
            await reg.fail(job_id, "draft_not_found", draft_id)
            return

        manifest = yaml.safe_load(
            (pack_root / "stylepack.yaml").read_text(encoding="utf-8")
        ) or {}

        reference_context = await get_reference_context(draft.id, draft.references)

        # Prepend profile-level background sources (facts/terminology, not style).
        from blogforge.voice.sources_context import build_background_context
        bg = await build_background_context(user_id)
        if bg:
            reference_context = f"{bg}\n\n{reference_context}" if reference_context else bg

        provider = await build_provider_for(user_id, provider_name)

        await reg.set_stage(job_id, "ideation:start")

        buf = ""
        proposed: OutlineProposal | None = None
        try:
            async for evt in stream_ideation(
                draft,
                new_user_content=new_user_content,
                reference_context=reference_context,
                provider=provider,
                model=model,
                pack_root=pack_root,
                manifest=manifest,
                mode=mode,
            ):
                if cancel_evt.is_set():
                    return
                kind = evt["kind"]
                if kind == "delta":
                    delta = evt["delta"]  # type: ignore[typeddict-item]
                    buf += delta
                    await reg.append_token(job_id, delta)
                elif kind == "result":
                    proposed = evt["proposed_outline"]  # type: ignore[typeddict-item]
                    buf = evt["text"]  # type: ignore[typeddict-item]  # full assembled text
        except ProviderMissingKey as e:
            await reg.fail(job_id, e.code, e.message, e.hint)
            return
        except ProviderError as e:
            await reg.fail(job_id, e.code, e.message)
            return

        # Persist the assistant message.
        from blogforge.db.engine import get_sessionmaker

        async with get_sessionmaker()() as session:
            assistant_msg = IdeationMessageRow(
                id=f"msg-{secrets.token_hex(6)}",
                draft_id=UUID(draft.id),
                position=assistant_position,
                role="assistant",
                content=buf,
                proposed_outline=(proposed.model_dump() if proposed else None),
            )
            session.add(assistant_msg)
            await session.commit()
            await session.refresh(assistant_msg)
            msg_id = assistant_msg.id

        await reg.set_stage(job_id, "ideation:done")
        await reg.complete(
            job_id,
            {"message_id": msg_id, "proposed_outline_present": proposed is not None},
        )
    except Exception as e:
        await reg.fail(job_id, "internal_error", f"Unexpected: {e}")
    finally:
        await _release(draft_id)


@router.post("/api/drafts/{draft_id}/ideation/accept", response_model=Draft)
async def accept_ideation(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    store = _store(request)
    draft = await store.get(draft_id, user_id=current.id)
    if draft is None:
        raise _draft_not_found(draft_id)

    # Find the most recent assistant message that carries a proposed_outline.
    proposal: OutlineProposal | None = None
    for msg in reversed(draft.ideation_messages):
        if msg.role == "assistant" and msg.proposed_outline is not None:
            proposal = msg.proposed_outline
            break
    if proposal is None:
        raise HTTPException(
            409,
            detail={
                "error": {
                    "code": "no_proposed_outline",
                    "message": "No assistant message with a proposed outline yet.",
                    "hint": "Ask the LLM to include a ```json outline.",
                }
            },
        )

    draft.outline = proposal
    # Seed sections from outline so the expand route doesn't 409 the moment
    # the user clicks Compose. Matches POST /api/drafts/{id}/outline.
    from blogforge.drafts.models import Section

    draft.sections = [
        Section(id=s.id, title=s.title, brief=s.brief) for s in proposal.sections
    ]
    draft.stage = "outline"
    draft.updated_at = datetime.now(UTC)
    updated = await store.update(draft.id, draft, user_id=current.id)
    if updated is None:
        raise _draft_not_found(draft_id)
    return updated
