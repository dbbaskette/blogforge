"""FastAPI application factory."""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from myvoice import PackStore

from pencraft import __version__
from pencraft.api.events import EventBus
from pencraft.drafts import DraftStore
from pencraft.jobs.registry import JobRegistry


def _default_static_dir() -> Path:
    return Path(__file__).parent / "static"


def _resolve_static_dir() -> Path:
    env = os.environ.get("PENCRAFT_STATIC_DIR")
    return Path(env) if env else _default_static_dir()


def _is_dev_mode() -> bool:
    return os.environ.get("PENCRAFT_DEV", "").lower() in ("1", "true", "yes")


def _resolve_drafts_root() -> Path:
    env = os.environ.get("PENCRAFT_DRAFTS_ROOT")
    if env:
        return Path(env)
    return Path.home() / ".pencraft" / "drafts"


def _resolve_pack_roots() -> list[Path]:
    """Same resolution as myvoice: env override > ~/.myvoice/packs > repo packs/."""
    env = os.environ.get("MYVOICE_PACKS_ROOT")
    if env:
        return [Path(env)]
    user_root = Path.home() / ".myvoice" / "packs"
    if user_root.is_dir():
        return [user_root]
    # Dev fallback: sibling myvoice repo
    repo_packs = Path(__file__).resolve().parents[3].parent / "myvoice" / "packs"
    if repo_packs.is_dir():
        return [repo_packs]
    return []


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    drafts_root = _resolve_drafts_root()
    app.state.draft_store = DraftStore(drafts_root)
    pack_roots = _resolve_pack_roots()
    app.state.pack_store = PackStore(pack_roots)
    app.state.job_registry = JobRegistry()
    app.state.event_bus = EventBus()
    yield


def create_app() -> FastAPI:
    """Build and return the FastAPI app."""
    app = FastAPI(title="pencraft", version=__version__, lifespan=_lifespan)

    from pencraft.api.download import router as download_router
    from pencraft.api.drafts import router as drafts_router
    from pencraft.api.events import router as events_router
    from pencraft.api.expand import router as expand_router
    from pencraft.api.jobs import router as jobs_router
    from pencraft.api.lint import router as lint_router
    from pencraft.api.outline import router as outline_router
    from pencraft.api.packs import router as packs_router
    from pencraft.api.providers import router as providers_router
    from pencraft.api.section import router as section_router

    app.include_router(drafts_router)
    app.include_router(outline_router)
    app.include_router(packs_router)
    app.include_router(providers_router)
    app.include_router(expand_router)
    app.include_router(section_router)
    app.include_router(jobs_router)
    app.include_router(download_router)
    app.include_router(lint_router)
    app.include_router(events_router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    static_dir = _resolve_static_dir()
    index = static_dir / "index.html"

    if index.is_file() and not _is_dev_mode():

        @app.get("/", response_class=FileResponse)
        def root() -> FileResponse:
            return FileResponse(index)

        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
    else:

        @app.get("/", response_class=HTMLResponse)
        def root_dev() -> str:
            return "<!doctype html><html><body><h1>pencraft dev</h1></body></html>"

    return app
