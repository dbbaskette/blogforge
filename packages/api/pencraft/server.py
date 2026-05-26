"""FastAPI application factory."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from pencraft import __version__


def _default_static_dir() -> Path:
    return Path(__file__).parent / "static"


def _resolve_static_dir() -> Path:
    env = os.environ.get("PENCRAFT_STATIC_DIR")
    return Path(env) if env else _default_static_dir()


def _is_dev_mode() -> bool:
    return os.environ.get("PENCRAFT_DEV", "").lower() in ("1", "true", "yes")


def create_app() -> FastAPI:
    """Build and return the FastAPI app."""
    app = FastAPI(title="pencraft", version=__version__)

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
            return (
                "<!doctype html><html><body>"
                "<h1>pencraft — dev mode</h1>"
                "<p>Run <code>pnpm dev</code> in <code>packages/web/</code> "
                "and visit <a href='http://localhost:7881'>http://localhost:7881</a>.</p>"
                "</body></html>"
            )

    return app
