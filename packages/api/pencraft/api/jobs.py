"""GET/DELETE /api/jobs/{id} + /api/jobs/{id}/events."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from pencraft.jobs.events import sse_format
from pencraft.jobs.registry import JobRegistry

router = APIRouter(tags=["jobs"])


@router.get("/api/jobs/{job_id}")
async def get_job(job_id: str, request: Request) -> dict[str, Any]:
    reg: JobRegistry = request.app.state.job_registry
    job = await reg.get(job_id)
    if job is None:
        raise HTTPException(404, detail={"error": {"code": "job_not_found", "message": job_id}})
    return job.model_dump(mode="json")


@router.delete("/api/jobs/{job_id}", status_code=204)
async def cancel_job(job_id: str, request: Request) -> None:
    reg: JobRegistry = request.app.state.job_registry
    cancelled = await reg.cancel(job_id)
    if not cancelled:
        raise HTTPException(404, detail={"error": {"code": "job_not_found", "message": job_id}})


@router.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request) -> StreamingResponse:
    reg: JobRegistry = request.app.state.job_registry
    job = await reg.get(job_id)
    if job is None:
        raise HTTPException(404, detail={"error": {"code": "job_not_found", "message": job_id}})

    async def stream() -> AsyncIterator[str]:
        for evt in reg.replay_snapshot(job_id):
            yield sse_format(evt)
        snap = await reg.get(job_id)
        if snap and snap.status in ("succeeded", "failed", "cancelled"):
            return
        q = await reg.subscribe(job_id)
        while True:
            if await request.is_disconnected():
                return
            try:
                evt = await asyncio.wait_for(q.get(), timeout=15.0)
            except TimeoutError:
                yield ": ping\n\n"
                continue
            yield sse_format(evt)
            if evt.get("type") in ("complete", "error"):
                return

    return StreamingResponse(stream(), media_type="text/event-stream")
