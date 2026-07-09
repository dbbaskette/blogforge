"""FastAPI application factory."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse

from blogforge import __version__
from blogforge.api.events import EventBus
from blogforge.config import get_settings
from blogforge.config.tanzu import apply_vcap_services
from blogforge.db.engine import get_engine, get_sessionmaker
from blogforge.db.seed import ensure_admin_user
from blogforge.drafts.sql_store import SqlDraftStore
from blogforge.jobs.registry import JobRegistry
from blogforge.templates.store import TemplateStore
from blogforge.voice import PackStore
from blogforge.voice.store import SqlVoiceStore

# Translate VCAP_SERVICES into BLOGFORGE_* env vars before Settings is read.
apply_vcap_services()


def _default_static_dir() -> Path:
    return Path(__file__).parent / "static"


def _resolve_static_dir() -> Path:
    env = os.environ.get("BLOGFORGE_STATIC_DIR")
    return Path(env) if env else _default_static_dir()


def _build_info() -> dict[str, str]:
    """Deploy identity written into the static dir at build time
    (scripts/cf-prepare.sh): the git ``commit`` and ``built_at``. Absent in
    dev/tests → empty dict, so /api/health still reports the semver."""
    try:
        data = json.loads((_resolve_static_dir() / "build_info.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: str(data[k]) for k in ("commit", "built_at") if isinstance(data.get(k), str)}


def _is_dev_mode() -> bool:
    return os.environ.get("BLOGFORGE_DEV", "").lower() in ("1", "true", "yes")


def _resolve_pack_roots() -> list[Path]:
    """Find every directory where myvoice packs might live.

    Priority order (first hit wins; missing entries skipped):
    1. ``MYVOICE_PACKS_ROOT`` env var (test/dev override).
    2. ``~/.myvoice/packs/`` if it exists.
    3. ``pack_paths`` from ``~/.myvoice/config.yaml`` (myvoice's own user config).
    4. Sibling myvoice repo's ``packs/`` dir (relative to the BlogForge repo, or
       to the current working directory — covers both ``uv run`` and
       wheel-installed launches).
    5. Walk-up from ``__file__`` — works when BlogForge is installed editable
       inside the repo (``parents[3].parent / 'myvoice' / 'packs'`` is the
       sibling-repo path); a no-op for wheel installs.
    """
    candidates: list[Path] = []
    env = os.environ.get("MYVOICE_PACKS_ROOT")
    if env:
        candidates.append(Path(env))
    candidates.append(Path.home() / ".myvoice" / "packs")
    # Read pack_paths from myvoice's config.
    candidates.extend(_read_myvoice_pack_paths())
    # Sibling-repo candidates: try common locations for a dev checkout.
    cwd = Path.cwd()
    candidates.extend(
        [
            cwd / ".." / "myvoice" / "packs",
            cwd.parent / "myvoice" / "packs",
            Path(__file__).resolve().parents[3].parent / "myvoice" / "packs",
        ]
    )
    # Dedupe by resolved path, keeping insertion order.
    seen: set[Path] = set()
    roots: list[Path] = []
    for raw in candidates:
        try:
            resolved = raw.expanduser().resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.is_dir():
            roots.append(resolved)
    return roots


def _read_myvoice_pack_paths() -> list[Path]:
    """Pull ``pack_paths`` from ~/.myvoice/config.yaml. Returns [] on any error."""
    import yaml

    cfg_env = os.environ.get("MYVOICE_CONFIG_PATH")
    cfg_path = Path(cfg_env) if cfg_env else Path.home() / ".myvoice" / "config.yaml"
    if not cfg_path.is_file():
        return []
    try:
        data = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    except (yaml.YAMLError, OSError):
        return []
    raw = data.get("pack_paths") or []
    return [Path(p) for p in raw if isinstance(p, str) and p]


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()

    # 1) Schema. SQLite (local, no-Docker dev) builds directly from the ORM
    # models — the Alembic migrations are authored for Postgres. Postgres (Tanzu)
    # runs the versioned migrations.
    if settings.run_migrations_on_boot:
        if settings.database_url.startswith("sqlite"):
            from blogforge.db.base import Base

            async with get_engine().begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        else:
            from alembic import command
            from alembic.config import Config as AlembicConfig

            # __file__ is packages/api/blogforge/server.py → parents[1] is packages/api.
            api_root = Path(__file__).resolve().parents[1]
            ini = api_root / "alembic.ini"
            cfg = AlembicConfig(str(ini))
            # Force absolute paths so migrations work regardless of CWD.
            cfg.set_main_option("script_location", str(api_root / "alembic"))
            cfg.set_main_option("sqlalchemy.url", settings.database_url)
            command.upgrade(cfg, "head")

    # 2) S3 bucket bootstrap. Idempotent; creates the bucket on first boot.
    if settings.s3_bootstrap_on_boot:
        from blogforge.s3.lifespan import ensure_bucket

        await ensure_bucket()

    # 3) Seed admin.
    async with get_sessionmaker()() as session:
        await ensure_admin_user(
            session, email=settings.admin_email, password=settings.admin_password
        )
        await session.commit()

    # 3.5) Recover sections stranded mid-generation by a prior crash/restart —
    # no generation survives a process restart, so any "generating" row is stale.
    async with get_sessionmaker()() as session:
        from blogforge.drafts.recovery import recover_stranded_sections

        await recover_stranded_sections(session)

    # 4) Per-request shared state.
    app.state.draft_store = SqlDraftStore()
    app.state.template_store = TemplateStore()
    app.state.pack_store = PackStore(_resolve_pack_roots())
    app.state.job_registry = JobRegistry()
    app.state.event_bus = EventBus()
    app.state.voice_store = SqlVoiceStore()

    yield

    await get_engine().dispose()


def create_app() -> FastAPI:
    """Build and return the FastAPI app."""
    settings = get_settings()
    app = FastAPI(title="blogforge", version=__version__, lifespan=_lifespan)

    from blogforge.errors import install_exception_handler

    install_exception_handler(app)

    from fastapi.responses import JSONResponse

    from blogforge.llm.exceptions import ProviderMissingKey

    @app.exception_handler(ProviderMissingKey)
    async def _missing_provider_key(_request, exc: ProviderMissingKey) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "code": "provider_missing_key",
                    "message": str(exc) or "No API key configured for this provider.",
                    "hint": "Add your key in Settings → Provider API keys.",
                }
            },
        )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["x-job-id"],
        )

    from blogforge.api.admin import router as admin_router
    from blogforge.api.auth import router as auth_router
    from blogforge.api.auth_github import router as auth_github_router
    from blogforge.api.claims import router as claims_router
    from blogforge.api.download import router as download_router
    from blogforge.api.drafts import router as drafts_router
    from blogforge.api.events import router as events_router
    from blogforge.api.expand import router as expand_router
    from blogforge.api.formats import router as formats_router
    from blogforge.api.geo import router as geo_router
    from blogforge.api.headlines import router as headlines_router
    from blogforge.api.help import router as help_router
    from blogforge.api.hero import router as hero_router
    from blogforge.api.humanize import router as humanize_router
    from blogforge.api.ideation import router as ideation_router
    from blogforge.api.inline import router as inline_router
    from blogforge.api.jobs import router as jobs_router
    from blogforge.api.keys import router as keys_router
    from blogforge.api.library import router as library_router
    from blogforge.api.lint import router as lint_router
    from blogforge.api.outline import router as outline_router
    from blogforge.api.packs import router as packs_router
    from blogforge.api.providers import router as providers_router
    from blogforge.api.references import router as references_router
    from blogforge.api.repurpose import router as repurpose_router
    from blogforge.api.revise import router as revise_router
    from blogforge.api.section import router as section_router
    from blogforge.api.suggest import router as suggest_router
    from blogforge.api.templates import router as templates_router
    from blogforge.api.topics import router as topics_router
    from blogforge.api.voice import router as voice_router

    app.include_router(auth_router)
    app.include_router(auth_github_router)
    app.include_router(admin_router)
    app.include_router(keys_router)
    app.include_router(drafts_router)
    app.include_router(references_router)
    app.include_router(outline_router)
    app.include_router(packs_router)
    app.include_router(formats_router)
    app.include_router(providers_router)
    app.include_router(expand_router)
    app.include_router(headlines_router)
    app.include_router(hero_router)
    app.include_router(ideation_router)
    app.include_router(inline_router)
    app.include_router(section_router)
    app.include_router(revise_router)
    app.include_router(repurpose_router)
    app.include_router(templates_router)
    app.include_router(library_router)
    app.include_router(jobs_router)
    app.include_router(download_router)
    app.include_router(lint_router)
    app.include_router(claims_router)
    app.include_router(events_router)
    app.include_router(geo_router)
    app.include_router(help_router)
    app.include_router(humanize_router)
    app.include_router(suggest_router)
    app.include_router(topics_router)
    app.include_router(voice_router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__, **_build_info()}

    static_dir = _resolve_static_dir()
    index = static_dir / "index.html"

    if index.is_file() and not _is_dev_mode():
        static_root = static_dir.resolve()

        # index.html (and any SPA-fallback HTML) must revalidate on every load so
        # a new deploy is picked up on a normal reload — no hard refresh needed.
        # The /assets/* bundles are content-hashed (their URL changes when they
        # change), so they can be cached forever.
        _HTML_CACHE = "no-cache"
        _ASSET_CACHE = "public, max-age=31536000, immutable"

        @app.get("/", response_class=FileResponse)
        def root() -> FileResponse:
            return FileResponse(index, headers={"Cache-Control": _HTML_CACHE})

        # SPA fallback: serve a real static file when one exists (hashed assets,
        # favicon, …), otherwise return index.html so client-side routes
        # (/login, /voice, /drafts/:id) resolve on a hard navigation or refresh.
        # /api/* stays a JSON 404 rather than silently returning the SPA shell.
        @app.get("/{full_path:path}", response_class=FileResponse)
        def spa_fallback(full_path: str) -> FileResponse:
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not Found")
            candidate = (static_dir / full_path).resolve()
            if candidate.is_file() and str(candidate).startswith(f"{static_root}/"):
                cache = _ASSET_CACHE if full_path.startswith("assets/") else _HTML_CACHE
                return FileResponse(candidate, headers={"Cache-Control": cache})
            return FileResponse(index, headers={"Cache-Control": _HTML_CACHE})
    else:

        @app.get("/", response_class=HTMLResponse)
        def root_dev() -> str:
            return "<!doctype html><html><body><h1>blogforge dev</h1></body></html>"

    return app
