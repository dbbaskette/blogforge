"""JobRegistry unit tests — create/cancel/LRU/replay."""
from __future__ import annotations

import pytest

from pencraft.jobs.models import JobType
from pencraft.jobs.registry import JobRegistry


@pytest.mark.asyncio
async def test_create_and_get() -> None:
    reg = JobRegistry()
    job = await reg.create(JobType.EXPAND)
    assert job.id
    assert job.status == "pending"
    fetched = await reg.get(job.id)
    assert fetched is job


@pytest.mark.asyncio
async def test_cancel_signals_event() -> None:
    reg = JobRegistry()
    job = await reg.create(JobType.EXPAND)
    evt = reg.cancellation_event(job.id)
    assert not evt.is_set()
    await reg.cancel(job.id)
    assert evt.is_set()
    refreshed = await reg.get(job.id)
    assert refreshed is not None
    assert refreshed.status == "cancelled"


@pytest.mark.asyncio
async def test_lru_eviction_keeps_max() -> None:
    reg = JobRegistry(max_size=3)
    j1 = await reg.create(JobType.EXPAND)
    j2 = await reg.create(JobType.EXPAND)
    j3 = await reg.create(JobType.EXPAND)
    # Mark them finished so they're eligible for eviction.
    for j in (j1, j2, j3):
        j.status = "succeeded"
        j.finished_at = j.started_at  # any value
    j4 = await reg.create(JobType.EXPAND)
    assert await reg.get(j1.id) is None  # oldest evicted
    assert await reg.get(j4.id) is not None


@pytest.mark.asyncio
async def test_append_token_buffers_for_replay() -> None:
    reg = JobRegistry()
    job = await reg.create(JobType.EXPAND)
    await reg.append_token(job.id, "Hello ")
    await reg.append_token(job.id, "world")
    refreshed = await reg.get(job.id)
    assert refreshed is not None
    assert refreshed.partial_text == "Hello world"


@pytest.mark.asyncio
async def test_replay_snapshot_for_completed_job() -> None:
    reg = JobRegistry()
    job = await reg.create(JobType.EXPAND)
    await reg.append_token(job.id, "output text")
    await reg.complete(job.id, {"output": "output text"})
    events = reg.replay_snapshot(job.id)
    types = [e["type"] for e in events]
    assert "stage" in types
    assert "token" in types
    assert "complete" in types


@pytest.mark.asyncio
async def test_no_eviction_when_all_in_flight() -> None:
    """If all jobs are in-flight, don't evict any."""
    reg = JobRegistry(max_size=2)
    j1 = await reg.create(JobType.EXPAND)
    j2 = await reg.create(JobType.EXPAND)
    # Both are pending (in-flight) — third create must not crash/evict.
    j3 = await reg.create(JobType.EXPAND)
    # j1 and j2 still present despite exceeding max_size.
    assert await reg.get(j1.id) is not None
    assert await reg.get(j2.id) is not None
    assert await reg.get(j3.id) is not None


@pytest.mark.asyncio
async def test_regen_section_job_type() -> None:
    """Ensure REGEN_SECTION job type works correctly."""
    reg = JobRegistry()
    job = await reg.create(JobType.REGEN_SECTION)
    assert job.type == JobType.REGEN_SECTION
    assert str(job.type) == "regen_section"
