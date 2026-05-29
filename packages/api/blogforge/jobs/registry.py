"""In-process JobRegistry: LRU eviction, cancellation events, live listeners."""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Any

from blogforge.jobs.models import Job, JobType

_TERMINAL = frozenset({"succeeded", "failed", "cancelled"})


class JobRegistry:
    """Capped in-process store for async jobs with SSE fan-out."""

    def __init__(self, max_size: int = 50) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._cancellation: dict[str, asyncio.Event] = {}
        self._listeners: dict[str, list[asyncio.Queue[dict[str, Any]]]] = {}
        self._lock = asyncio.Lock()
        self._max = max_size

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def create(self, type_: JobType, draft_id: str | None = None) -> Job:
        """Create a new job, evict oldest finished job if at capacity."""
        job = Job(type=type_, draft_id=draft_id)
        async with self._lock:
            self._jobs[job.id] = job
            self._cancellation[job.id] = asyncio.Event()
            self._listeners[job.id] = []
            self._evict_if_full()
        return job

    async def get(self, job_id: str) -> Job | None:
        """Return the job or None if evicted/unknown."""
        return self._jobs.get(job_id)

    def active_for_draft(self, draft_id: str) -> Job | None:
        """The most-recent non-terminal job for a draft, or None.

        Lets a reloaded client re-attach to an in-flight compose/revise so
        progress keeps streaming after a refresh."""
        found: Job | None = None
        for job in self._jobs.values():  # insertion order: oldest → newest
            if job.draft_id == draft_id and job.status not in _TERMINAL:
                found = job
        return found

    def cancellation_event(self, job_id: str) -> asyncio.Event:
        """Return the asyncio.Event that signals cancellation for this job."""
        return self._cancellation[job_id]

    async def cancel(self, job_id: str) -> bool:
        """Cancel a job: set its event, mark status, broadcast error event.

        Returns True if the job was cancelled, False if not found or already terminal.
        """
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in _TERMINAL:
                return False
            self._cancellation[job_id].set()
            job.status = "cancelled"
            job.finished_at = datetime.now(UTC)
        await self._broadcast(
            job_id,
            {"type": "error", "code": "cancelled", "message": "Cancelled by user."},
        )
        return True

    async def append_token(self, job_id: str, delta: str) -> None:
        """Append a text token to the replay buffer and broadcast to listeners."""
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.partial_text += delta
        await self._broadcast(job_id, {"type": "token", "delta": delta})

    async def set_stage(
        self, job_id: str, stage: str, progress: float | None = None
    ) -> None:
        """Update the current stage (and optionally progress) for a job."""
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.stage = stage
            if progress is not None:
                job.progress = progress
            if job.status == "pending":
                job.status = "running"
        await self._broadcast(
            job_id,
            {"type": "stage", "name": stage, "progress": progress or 0.0},
        )

    async def complete(self, job_id: str, result: dict[str, Any]) -> None:
        """Mark a job succeeded and broadcast the complete event."""
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.status = "succeeded"
            job.finished_at = datetime.now(UTC)
            job.result = result
            job.progress = 1.0
        await self._broadcast(job_id, {"type": "complete", "result": result})

    async def fail(
        self, job_id: str, code: str, message: str, hint: str | None = None
    ) -> None:
        """Mark a job failed and broadcast the error event."""
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.status = "failed"
            job.finished_at = datetime.now(UTC)
            job.error = {"code": code, "message": message, "hint": hint}
        await self._broadcast(
            job_id,
            {"type": "error", "code": code, "message": message, "hint": hint},
        )

    async def subscribe(self, job_id: str) -> asyncio.Queue[dict[str, Any]]:
        """Return a queue that receives every future event for this job."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        async with self._lock:
            self._listeners.setdefault(job_id, []).append(q)
        return q

    def replay_snapshot(self, job_id: str) -> list[dict[str, Any]]:
        """Return the ordered list of events to emit to a freshly-connecting subscriber.

        Emits: stage → token (if partial_text) → terminal (if done).
        """
        job = self._jobs.get(job_id)
        if job is None:
            return []
        events: list[dict[str, Any]] = [
            {"type": "stage", "name": job.stage, "progress": job.progress}
        ]
        if job.partial_text:
            events.append({"type": "token", "delta": job.partial_text})
        if job.status == "succeeded":
            events.append({"type": "complete", "result": job.result or {}})
        elif job.status == "failed":
            events.append({"type": "error", **(job.error or {})})
        elif job.status == "cancelled":
            events.append(
                {"type": "error", "code": "cancelled", "message": "Cancelled."}
            )
        return events

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _broadcast(self, job_id: str, event: dict[str, Any]) -> None:
        """Put event on every listener queue for this job."""
        listeners = list(self._listeners.get(job_id, []))
        for q in listeners:
            await q.put(event)

    def _evict_if_full(self) -> None:
        """Evict oldest finished jobs until under max_size. Never evicts in-flight jobs."""
        while len(self._jobs) > self._max:
            evicted = False
            for jid, job in self._jobs.items():
                if job.status in _TERMINAL:
                    del self._jobs[jid]
                    self._cancellation.pop(jid, None)
                    self._listeners.pop(jid, None)
                    evicted = True
                    break
            if not evicted:
                # All jobs are in-flight; cannot evict.
                break
