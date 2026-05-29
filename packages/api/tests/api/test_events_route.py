"""GET /api/events — global SSE event bus."""
from __future__ import annotations

from pathlib import Path

import pytest


def test_event_bus_in_app_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify EventBus is wired into app state during lifespan."""
    from fastapi.testclient import TestClient

    from blogforge.api.events import EventBus
    from blogforge.server import create_app

    monkeypatch.setenv("BLOGFORGE_DRAFTS_ROOT", str(tmp_path / "drafts"))
    app = create_app()
    with TestClient(app):
        assert isinstance(app.state.event_bus, EventBus)


def test_event_bus_subscribe_and_emit() -> None:
    """Verify EventBus subscribe/emit works correctly (unit test)."""
    import asyncio

    from blogforge.api.events import EventBus

    async def _run() -> None:
        bus = EventBus()
        q = await bus.subscribe()
        await bus.emit({"type": "draft:created", "id": "abc", "title": "Test"})
        evt = q.get_nowait()
        assert evt["type"] == "draft:created"
        assert evt["id"] == "abc"
        await bus.unsubscribe(q)
        assert len(bus._listeners) == 0

    asyncio.run(_run())
