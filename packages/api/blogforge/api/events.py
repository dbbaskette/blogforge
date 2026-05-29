"""GET /api/events — global SSE for draft:created/updated/deleted."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from blogforge.jobs.events import sse_format

router = APIRouter(tags=["events"])


class EventBus:
    def __init__(self) -> None:
        self._listeners: list[asyncio.Queue[dict[str, object]]] = []
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue[dict[str, object]]:
        async with self._lock:
            q: asyncio.Queue[dict[str, object]] = asyncio.Queue()
            self._listeners.append(q)
            return q

    async def unsubscribe(self, q: asyncio.Queue[dict[str, object]]) -> None:
        async with self._lock:
            if q in self._listeners:
                self._listeners.remove(q)

    async def emit(self, event: dict[str, object]) -> None:
        async with self._lock:
            listeners = list(self._listeners)
        for q in listeners:
            await q.put(event)


@router.get("/api/events")
async def global_events(request: Request) -> StreamingResponse:
    bus: EventBus = request.app.state.event_bus

    async def stream() -> AsyncIterator[str]:
        q = await bus.subscribe()
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=15.0)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield sse_format(evt)
        finally:
            await bus.unsubscribe(q)

    return StreamingResponse(stream(), media_type="text/event-stream")
