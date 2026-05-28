"""FastAPI application factory for the LinkedIn connector."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pencraft import __version__
from pencraft.config import get_settings
from pencraft.linkedin.routes import router


def create_linkedin_app() -> FastAPI:
    """Build the connector app. Shares Pencraft's CORS origins so the web
    client (same cookie) can call it cross-origin in dev."""
    settings = get_settings()
    app = FastAPI(title="pencraft-linkedin", version=__version__)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(router)
    return app
