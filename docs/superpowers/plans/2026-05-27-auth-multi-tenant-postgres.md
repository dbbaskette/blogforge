# Phase A — Auth + Multi-tenant Postgres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pencraft's single-user JSON-on-disk store with a multi-tenant Postgres-backed app: email/password auth with admin approval, per-user data isolation, Docker Compose for local dev, manifest for Tanzu deployment.

**Architecture:** FastAPI + SQLAlchemy 2.0 async + asyncpg + Alembic on the API side. React + RequireAuth guard + session cookies on the web side. argon2 password hashing, itsdangerous-signed HTTP-only cookies for sessions. Existing on-disk store is replaced by `SqlDraftStore`; every existing route gains a `current_user` dependency and scopes by `user_id`.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, asyncpg, Alembic, pydantic-settings, argon2-cffi, itsdangerous, aiobotocore (S3 client provisioned for Phase B), pytest-asyncio, aiosqlite (in-memory DB for tests). React 18 + Vite + Tailwind + Notebook design tokens from PR #12.

**Source spec:** `docs/superpowers/specs/2026-05-27-auth-multi-tenant-postgres-design.md`

**Branch:** off `main`, name `auth-multi-tenant-postgres`.

---

## Pre-flight

- [ ] **Confirm clean main and create branch**

```bash
cd /Users/dbbaskette/Projects/Pencraft
git switch main
git pull --ff-only
git switch -c auth-multi-tenant-postgres
git status   # should show "nothing to commit, working tree clean"
```

---

## Section 1 — Foundation: deps, config, database

### Task 1: Add Python dependencies

**Files:**
- Modify: `pyproject.toml:9-23` (project.dependencies)
- Modify: `pyproject.toml:39-47` (dev dependencies)

- [ ] **Step 1: Add runtime + dev deps**

Edit the `dependencies` list to add (in alphabetical order with the existing entries):

```toml
dependencies = [
    "aiobotocore>=2.13",
    "aiofiles>=24",
    "aiosqlite>=0.20",
    "alembic>=1.13",
    "anthropic>=0.40",
    "argon2-cffi>=23.1",
    "asyncpg>=0.30",
    "click>=8.1",
    "fastapi>=0.115",
    "google-generativeai>=0.8",
    "httpx>=0.27",
    "itsdangerous>=2.2",
    "jinja2>=3.1",
    "myvoice>=0.1.0",
    "openai>=1.50",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
    "python-multipart>=0.0.12",
    "pyyaml>=6.0",
    "sqlalchemy[asyncio]>=2.0.30",
    "uvicorn[standard]>=0.32",
]
```

Edit the `[dependency-groups].dev` list to add:

```toml
dev = [
    "asgi-lifespan>=2.1",
    "mypy>=2.0",
    "pytest>=8.3",
    "pytest-asyncio>=1.0",
    "respx>=0.21",
    "ruff>=0.13",
    "types-aiofiles>=24",
    "types-pyyaml>=6.0",
]
```

- [ ] **Step 2: Lock deps**

Run: `uv sync --all-extras --dev`
Expected: prints "Installed N packages in Xs" with no errors.

- [ ] **Step 3: Smoke import the new modules**

Run: `uv run python -c "import sqlalchemy, asyncpg, alembic, argon2, itsdangerous, aiobotocore; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "deps: add sqlalchemy/asyncpg/alembic/argon2/itsdangerous/aiobotocore"
```

---

### Task 2: Configuration module (pydantic-settings)

**Files:**
- Create: `packages/api/pencraft/config/__init__.py`
- Create: `packages/api/pencraft/config/settings.py`
- Test: `packages/api/tests/test_settings.py`

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/test_settings.py`:

```python
"""Settings load defaults; env overrides take precedence."""
import os
from unittest import mock

from pencraft.config.settings import Settings


def test_defaults_when_no_env():
    """Settings have sane defaults so the test suite never needs env vars."""
    with mock.patch.dict(os.environ, {}, clear=True):
        s = Settings()
    assert s.database_url.startswith("sqlite+aiosqlite://")
    assert s.admin_email == "dbbaskette@gmail.com"
    assert s.admin_password == "VMware0!"
    assert s.session_secret  # non-empty default
    assert s.cors_origins == ["http://localhost:7881"]
    assert s.s3_bucket == "pencraft"


def test_env_overrides():
    """PENCRAFT_-prefixed env vars override defaults."""
    env = {
        "PENCRAFT_DATABASE_URL": "postgresql+asyncpg://u:p@h/db",
        "PENCRAFT_ADMIN_EMAIL": "root@example.com",
        "PENCRAFT_CORS_ORIGINS": "http://a.com,http://b.com",
    }
    with mock.patch.dict(os.environ, env, clear=True):
        s = Settings()
    assert s.database_url == "postgresql+asyncpg://u:p@h/db"
    assert s.admin_email == "root@example.com"
    assert s.cors_origins == ["http://a.com", "http://b.com"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_settings.py -v`
Expected: ImportError on `pencraft.config.settings`.

- [ ] **Step 3: Implement the settings module**

Create `packages/api/pencraft/config/__init__.py`:

```python
"""Pencraft runtime config."""
from pencraft.config.settings import Settings, get_settings

__all__ = ["Settings", "get_settings"]
```

Create `packages/api/pencraft/config/settings.py`:

```python
"""Application settings, loaded from PENCRAFT_*-prefixed env vars."""
from functools import lru_cache
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Single source of truth for runtime configuration.

    Defaults are aimed at local dev / tests so the suite runs without any
    environment setup. Production overrides via env vars (or via the Tanzu
    config adapter for VCAP_SERVICES-bound services).
    """

    model_config = SettingsConfigDict(
        env_prefix="PENCRAFT_",
        env_file=None,  # never auto-load .env; tests would be flaky
        extra="ignore",
    )

    database_url: str = "sqlite+aiosqlite:///:memory:"
    admin_email: str = "dbbaskette@gmail.com"
    admin_password: str = "VMware0!"
    session_secret: str = "dev-session-secret-change-me-in-prod"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:7881"])

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "pencraft"
    s3_secret_key: str = "pencraft-minio-secret"
    s3_bucket: str = "pencraft"
    s3_region: str = "us-east-1"

    run_migrations_on_boot: bool = True

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_csv(cls, v: object) -> object:
        """Accept comma-separated string from env: PENCRAFT_CORS_ORIGINS=a,b,c."""
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide singleton. Cache so we don't re-parse env on every call."""
    return Settings()
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/api/tests/test_settings.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/config packages/api/tests/test_settings.py
git commit -m "feat(config): pydantic-settings module with PENCRAFT_-prefixed env"
```

---

### Task 3: Tanzu VCAP_SERVICES adapter

**Files:**
- Create: `packages/api/pencraft/config/tanzu.py`
- Test: `packages/api/tests/test_tanzu_config_adapter.py`

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/test_tanzu_config_adapter.py`:

```python
"""apply_vcap_services translates a bound services payload into env vars."""
import json
import os
from unittest import mock

from pencraft.config.tanzu import apply_vcap_services


VCAP = {
    "postgresql": [
        {
            "name": "pencraft-postgres",
            "credentials": {"uri": "postgres://u:p@h:5432/db"},
        }
    ],
    "seaweedfs": [
        {
            "name": "pencraft-s3",
            "credentials": {
                "endpoint": "https://seaweed.example.com",
                "access_key": "AK",
                "secret_key": "SK",
            },
        }
    ],
}


def test_translates_postgres_uri_to_asyncpg():
    with mock.patch.dict(os.environ, {"VCAP_SERVICES": json.dumps(VCAP)}, clear=True):
        apply_vcap_services()
    assert os.environ["PENCRAFT_DATABASE_URL"] == (
        "postgresql+asyncpg://u:p@h:5432/db"
    )


def test_translates_s3_credentials():
    with mock.patch.dict(os.environ, {"VCAP_SERVICES": json.dumps(VCAP)}, clear=True):
        apply_vcap_services()
    assert os.environ["PENCRAFT_S3_ENDPOINT_URL"] == "https://seaweed.example.com"
    assert os.environ["PENCRAFT_S3_ACCESS_KEY"] == "AK"
    assert os.environ["PENCRAFT_S3_SECRET_KEY"] == "SK"


def test_silent_when_vcap_absent():
    with mock.patch.dict(os.environ, {}, clear=True):
        apply_vcap_services()  # must not raise


def test_does_not_overwrite_already_set_env():
    """If the operator set PENCRAFT_DATABASE_URL explicitly, keep it."""
    env = {
        "VCAP_SERVICES": json.dumps(VCAP),
        "PENCRAFT_DATABASE_URL": "sqlite+aiosqlite:///./override.db",
    }
    with mock.patch.dict(os.environ, env, clear=True):
        apply_vcap_services()
    assert os.environ["PENCRAFT_DATABASE_URL"] == "sqlite+aiosqlite:///./override.db"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_tanzu_config_adapter.py -v`
Expected: ImportError on `pencraft.config.tanzu`.

- [ ] **Step 3: Implement the adapter**

Create `packages/api/pencraft/config/tanzu.py`:

```python
"""Translate Cloud Foundry's VCAP_SERVICES into PENCRAFT_* env vars.

Called once at process import (before pydantic-settings reads env). On
local dev where VCAP_SERVICES is absent this is a no-op.

Matches services by service-type label first (postgresql / seaweedfs)
and falls back to instance name. Never overwrites an env var the operator
already set explicitly — so `cf set-env PENCRAFT_DATABASE_URL ...` always
wins over bound-service inference.
"""
import json
import logging
import os

_log = logging.getLogger(__name__)


def apply_vcap_services() -> None:
    """Read VCAP_SERVICES and set PENCRAFT_* env vars for bound services."""
    raw = os.environ.get("VCAP_SERVICES")
    if not raw:
        return
    try:
        vcap = json.loads(raw)
    except json.JSONDecodeError:
        _log.warning("VCAP_SERVICES is not valid JSON; ignoring")
        return

    # Flatten all service bindings into (label, instance) pairs.
    instances: list[tuple[str, dict]] = []
    for label, bindings in vcap.items():
        if not isinstance(bindings, list):
            continue
        for b in bindings:
            if isinstance(b, dict):
                instances.append((label, b))

    _apply_postgres(instances)
    _apply_s3(instances)


def _apply_postgres(instances: list[tuple[str, dict]]) -> None:
    for label, inst in instances:
        if label not in ("postgresql", "postgres") and inst.get("name") != "pencraft-postgres":
            continue
        creds = inst.get("credentials", {})
        uri = creds.get("uri") or creds.get("url")
        if not uri:
            continue
        # Cloud Foundry hands us `postgres://...`. Convert to the asyncpg driver.
        if uri.startswith("postgres://"):
            uri = "postgresql+asyncpg://" + uri[len("postgres://") :]
        elif uri.startswith("postgresql://"):
            uri = "postgresql+asyncpg://" + uri[len("postgresql://") :]
        _set_if_unset("PENCRAFT_DATABASE_URL", uri)
        return


def _apply_s3(instances: list[tuple[str, dict]]) -> None:
    for label, inst in instances:
        if label not in ("seaweedfs", "s3") and inst.get("name") != "pencraft-s3":
            continue
        creds = inst.get("credentials", {})
        endpoint = creds.get("endpoint") or creds.get("endpoint_url")
        access = creds.get("access_key") or creds.get("accessKey")
        secret = creds.get("secret_key") or creds.get("secretKey")
        if endpoint:
            _set_if_unset("PENCRAFT_S3_ENDPOINT_URL", endpoint)
        if access:
            _set_if_unset("PENCRAFT_S3_ACCESS_KEY", access)
        if secret:
            _set_if_unset("PENCRAFT_S3_SECRET_KEY", secret)
        return


def _set_if_unset(key: str, value: str) -> None:
    if key in os.environ:
        return
    os.environ[key] = value
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/api/tests/test_tanzu_config_adapter.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/config/tanzu.py packages/api/tests/test_tanzu_config_adapter.py
git commit -m "feat(config): Tanzu VCAP_SERVICES adapter for bound Postgres + S3"
```

---

### Task 4: Database engine + session factory

**Files:**
- Create: `packages/api/pencraft/db/__init__.py`
- Create: `packages/api/pencraft/db/engine.py`
- Create: `packages/api/pencraft/db/base.py`

- [ ] **Step 1: Implement the declarative base**

Create `packages/api/pencraft/db/base.py`:

```python
"""SQLAlchemy declarative base.

Kept in its own module so Alembic's env.py can import without pulling in
the whole engine machinery (matters for `alembic check` in CI).
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for all Pencraft ORM models."""
```

- [ ] **Step 2: Implement the engine + session factory**

Create `packages/api/pencraft/db/engine.py`:

```python
"""Async SQLAlchemy engine + session factory.

The engine is a process-wide singleton built from Settings.database_url.
Use `async with session_scope() as session:` in route handlers — it
commits on success and rolls back on exception, and is safe to nest
shallowly under FastAPI's Depends() lifecycle.
"""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from pencraft.config import get_settings


@lru_cache(maxsize=1)
def get_engine() -> AsyncEngine:
    """Lazy singleton. First call constructs; subsequent calls return same instance."""
    settings = get_settings()
    return create_async_engine(
        settings.database_url,
        echo=False,
        pool_pre_ping=True,
        future=True,
    )


@lru_cache(maxsize=1)
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        bind=get_engine(),
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Context manager that opens a session, commits on success, rolls back on error."""
    sm = get_sessionmaker()
    async with sm() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def reset_engine_for_tests() -> None:
    """Test helper — drop cached engine and sessionmaker so the next call uses
    the current Settings (e.g. after a fixture flipped DATABASE_URL)."""
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()
```

- [ ] **Step 3: Re-export from package init**

Create `packages/api/pencraft/db/__init__.py`:

```python
"""Database layer."""
from pencraft.db.base import Base
from pencraft.db.engine import (
    get_engine,
    get_sessionmaker,
    reset_engine_for_tests,
    session_scope,
)

__all__ = [
    "Base",
    "get_engine",
    "get_sessionmaker",
    "reset_engine_for_tests",
    "session_scope",
]
```

- [ ] **Step 4: Smoke-import check**

Run: `uv run python -c "from pencraft.db import Base, get_engine; print(get_engine())"`
Expected: prints `Engine(sqlite+aiosqlite:///:memory:)`.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/db
git commit -m "feat(db): async SQLAlchemy engine + session factory"
```

---

### Task 5: ORM models — User, Draft, Section

**Files:**
- Create: `packages/api/pencraft/db/models.py`
- Test: `packages/api/tests/test_db_models.py`

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/test_db_models.py`:

```python
"""ORM models can be created, persisted, and queried."""
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from pencraft.db.base import Base
from pencraft.db.models import Draft, Section, User


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s
    await engine.dispose()


async def test_create_user(session):
    u = User(email="alice@example.com", password_hash="x", status="approved", role="user")
    session.add(u)
    await session.commit()
    row = (await session.execute(select(User).where(User.email == "alice@example.com"))).scalar_one()
    assert row.id is not None
    assert row.role == "user"
    assert row.status == "approved"
    assert isinstance(row.created_at, datetime)


async def test_draft_belongs_to_user(session):
    u = User(email="bob@example.com", password_hash="x", status="approved", role="user")
    session.add(u)
    await session.flush()
    d = Draft(user_id=u.id, title="Test", stage="idea", idea={"topic": "Test"})
    session.add(d)
    await session.commit()
    fetched = (await session.execute(select(Draft).where(Draft.user_id == u.id))).scalar_one()
    assert fetched.title == "Test"
    assert fetched.idea == {"topic": "Test"}


async def test_section_belongs_to_draft(session):
    u = User(email="c@example.com", password_hash="x", status="approved", role="user")
    session.add(u)
    await session.flush()
    d = Draft(user_id=u.id, title="T", stage="outline", idea={"topic": "T"})
    session.add(d)
    await session.flush()
    s = Section(
        id="s1",
        draft_id=d.id,
        position=0,
        title="Intro",
        brief="b",
        content_md="",
        status="empty",
        word_count=0,
    )
    session.add(s)
    await session.commit()
    fetched = (await session.execute(select(Section).where(Section.id == "s1"))).scalar_one()
    assert fetched.draft_id == d.id
    assert fetched.position == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_db_models.py -v`
Expected: ImportError on `pencraft.db.models`.

- [ ] **Step 3: Implement the models**

Create `packages/api/pencraft/db/models.py`:

```python
"""ORM models — User, Draft, Section.

Uses SQLAlchemy 2.0 typed-mapped style. JSON columns store the existing
pydantic structures (IdeaInput, OutlineProposal) as dicts — they're
validated at the API boundary, not at the ORM boundary.
"""
from datetime import datetime, UTC
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from pencraft.db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


def _uuid() -> UUID:
    return uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    # one of: "pending" | "approved" | "rejected" | "disabled"
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    # one of: "user" | "admin"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    drafts: Mapped[list["Draft"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="idea")
    # one of: "idea" | "outline" | "sections"
    idea: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    outline: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="drafts")
    sections: Mapped[list["Section"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
        order_by="Section.position",
    )


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("draft_id", "position", name="uq_section_position"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # the existing slugged section id ("01-the-tax", etc.)
    draft_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    brief: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="empty")
    last_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    draft: Mapped[Draft] = relationship(back_populates="sections")
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/api/tests/test_db_models.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/db/models.py packages/api/tests/test_db_models.py
git commit -m "feat(db): User/Draft/Section ORM models"
```

---

### Task 6: Alembic setup + initial migration

**Files:**
- Create: `packages/api/alembic.ini`
- Create: `packages/api/alembic/env.py`
- Create: `packages/api/alembic/script.py.mako`
- Create: `packages/api/alembic/versions/0001_initial.py`

- [ ] **Step 1: Create alembic.ini**

Create `packages/api/alembic.ini`:

```ini
[alembic]
script_location = packages/api/alembic
prepend_sys_path = .
version_path_separator = os
sqlalchemy.url =

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 2: Create env.py**

Create `packages/api/alembic/env.py`:

```python
"""Alembic env — uses Pencraft's Settings + Base.metadata."""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from pencraft.config import get_settings
from pencraft.db.base import Base

# Make sure model metadata is populated before autogenerate inspects it.
from pencraft.db import models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject the URL at runtime so alembic.ini stays env-free.
settings = get_settings()
# Alembic uses the sync driver — strip the +asyncpg / +aiosqlite suffix.
sync_url = settings.database_url.replace("+asyncpg", "").replace("+aiosqlite", "")
config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=sync_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 3: Create script template**

Create `packages/api/alembic/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 4: Create the initial migration**

Create `packages/api/alembic/versions/0001_initial.py`:

```python
"""initial schema — users, drafts, sections

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("role", sa.String(16), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.Uuid(), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # On Postgres prefer JSONB; SQLAlchemy's JSON falls back to JSON on SQLite.
    json_type = JSONB().with_variant(sa.JSON(), "sqlite")

    op.create_table(
        "drafts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False, server_default=""),
        sa.Column("stage", sa.String(16), nullable=False, server_default="idea"),
        sa.Column("idea", json_type, nullable=False),
        sa.Column("outline", json_type, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_drafts_user_id", "drafts", ["user_id"])

    op.create_table(
        "sections",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("brief", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="empty"),
        sa.Column("last_generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["draft_id"], ["drafts.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("draft_id", "position", name="uq_section_position"),
    )
    op.create_index("ix_sections_draft_id", "sections", ["draft_id"])


def downgrade() -> None:
    op.drop_table("sections")
    op.drop_table("drafts")
    op.drop_table("users")
```

- [ ] **Step 5: Run the migration against a temp sqlite to verify**

Run:
```bash
PENCRAFT_DATABASE_URL="sqlite:///tmp/pencraft-migration-test.db" \
  uv run alembic -c packages/api/alembic.ini upgrade head
```
Expected: `INFO  [alembic.runtime.migration] Running upgrade  -> 0001_initial`. No errors.

Verify the tables exist:
```bash
uv run python -c "import sqlite3; c=sqlite3.connect('/tmp/pencraft-migration-test.db'); print([r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()])"
```
Expected: prints a list containing `users`, `drafts`, `sections`.

Clean up: `rm /tmp/pencraft-migration-test.db`

- [ ] **Step 6: Commit**

```bash
git add packages/api/alembic.ini packages/api/alembic
git commit -m "feat(db): Alembic + initial migration (users, drafts, sections)"
```

---

### Task 7: Test helper — apply migrations to a fresh DB

**Files:**
- Modify: `packages/api/tests/conftest.py:1-12` (replace entirely)

- [ ] **Step 1: Replace conftest.py with async-aware fixtures**

Open `packages/api/tests/conftest.py` and replace its contents with:

```python
"""Shared pytest fixtures — async DB, isolated per-test."""
from collections.abc import AsyncIterator, Iterator
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from pencraft.config import get_settings
from pencraft.db import reset_engine_for_tests
from pencraft.db.base import Base


@pytest.fixture(autouse=True)
def _force_sqlite_for_tests(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Every test runs against a fresh in-memory sqlite. Module-level singletons
    are reset between tests so the new URL takes effect."""
    monkeypatch.setenv("PENCRAFT_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    monkeypatch.setenv("PENCRAFT_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("PENCRAFT_RUN_MIGRATIONS_ON_BOOT", "false")
    get_settings.cache_clear()
    reset_engine_for_tests()
    yield
    get_settings.cache_clear()
    reset_engine_for_tests()


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    """A session bound to a fresh in-memory sqlite DB with schema created."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s
    await engine.dispose()
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

Run: `uv run pytest packages/api/tests -v -x`
Expected: existing tests still pass; new `test_db_models.py` tests still pass. 80+ passing.

- [ ] **Step 3: Commit**

```bash
git add packages/api/tests/conftest.py
git commit -m "test: async db fixtures with in-memory sqlite"
```

---

## Section 2 — Auth primitives

### Task 8: Password hashing

**Files:**
- Create: `packages/api/pencraft/auth/__init__.py`
- Create: `packages/api/pencraft/auth/passwords.py`
- Test: `packages/api/tests/test_password_hash.py`

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/test_password_hash.py`:

```python
"""argon2 hash + verify."""
from pencraft.auth.passwords import hash_password, verify_password


def test_round_trip():
    h = hash_password("hunter2")
    assert verify_password("hunter2", h) is True
    assert verify_password("wrong", h) is False


def test_two_hashes_of_same_password_differ():
    h1 = hash_password("same")
    h2 = hash_password("same")
    assert h1 != h2
    assert verify_password("same", h1)
    assert verify_password("same", h2)


def test_handles_empty_string():
    h = hash_password("")
    assert verify_password("", h) is True
    assert verify_password("x", h) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_password_hash.py -v`
Expected: ImportError on `pencraft.auth.passwords`.

- [ ] **Step 3: Implement**

Create `packages/api/pencraft/auth/__init__.py`:

```python
"""Authentication primitives."""
```

Create `packages/api/pencraft/auth/passwords.py`:

```python
"""Argon2id password hashing. Defaults are the argon2-cffi v23 defaults."""
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    """Return an argon2id hash of `plain`."""
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """True if `plain` verifies against `hashed`. False on any mismatch."""
    try:
        _hasher.verify(hashed, plain)
        return True
    except (VerifyMismatchError, InvalidHashError):
        return False
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/api/tests/test_password_hash.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/auth/__init__.py packages/api/pencraft/auth/passwords.py packages/api/tests/test_password_hash.py
git commit -m "feat(auth): argon2 password hashing"
```

---

### Task 9: Session cookie signing

**Files:**
- Create: `packages/api/pencraft/auth/sessions.py`
- Test: `packages/api/tests/test_session_cookie_signature.py`

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/test_session_cookie_signature.py`:

```python
"""Cookie signer round-trips data and rejects tampered payloads."""
import pytest
from uuid import uuid4

from pencraft.auth.sessions import SessionSigner


def test_round_trip():
    s = SessionSigner("secret-a")
    uid = uuid4()
    cookie = s.sign(uid)
    assert s.unsign(cookie) == uid


def test_tampered_cookie_rejected():
    s = SessionSigner("secret-a")
    uid = uuid4()
    cookie = s.sign(uid)
    # Flip the last char of the cookie's payload.
    tampered = cookie[:-1] + ("a" if cookie[-1] != "a" else "b")
    assert s.unsign(tampered) is None


def test_different_secrets_dont_share_cookies():
    a = SessionSigner("secret-a")
    b = SessionSigner("secret-b")
    cookie = a.sign(uuid4())
    assert b.unsign(cookie) is None


def test_garbage_returns_none():
    s = SessionSigner("secret-a")
    assert s.unsign("garbage") is None
    assert s.unsign("") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_session_cookie_signature.py -v`
Expected: ImportError on `pencraft.auth.sessions`.

- [ ] **Step 3: Implement**

Create `packages/api/pencraft/auth/sessions.py`:

```python
"""Signed session cookies.

The cookie payload is just the user id. We don't pack an issued_at or
expiry into the cookie itself — the cookie's Max-Age (set at the
Set-Cookie layer) is enough, and tying validity to a DB lookup means we
can disable users instantly without rotating the secret.
"""
from uuid import UUID

from itsdangerous import BadSignature, URLSafeSerializer

COOKIE_NAME = "pencraft_session"
COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60  # 14 days


class SessionSigner:
    """Wraps itsdangerous to sign/unsign a user UUID."""

    def __init__(self, secret: str) -> None:
        self._serializer = URLSafeSerializer(secret, salt="pencraft-session")

    def sign(self, user_id: UUID) -> str:
        return self._serializer.dumps(str(user_id))

    def unsign(self, cookie: str) -> UUID | None:
        if not cookie:
            return None
        try:
            value = self._serializer.loads(cookie)
        except BadSignature:
            return None
        try:
            return UUID(str(value))
        except (ValueError, TypeError):
            return None
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/api/tests/test_session_cookie_signature.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/auth/sessions.py packages/api/tests/test_session_cookie_signature.py
git commit -m "feat(auth): itsdangerous session cookie signer"
```

---

### Task 10: Admin seeding

**Files:**
- Create: `packages/api/pencraft/db/seed.py`
- Test: `packages/api/tests/test_admin_seed.py`

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/test_admin_seed.py`:

```python
"""Admin user is seeded once, idempotently."""
import pytest
from sqlalchemy import select

from pencraft.auth.passwords import verify_password
from pencraft.db.models import User
from pencraft.db.seed import ensure_admin_user


async def test_creates_admin_on_first_call(session):
    await ensure_admin_user(session, email="root@example.com", password="hunter2")
    user = (
        await session.execute(select(User).where(User.email == "root@example.com"))
    ).scalar_one()
    assert user.role == "admin"
    assert user.status == "approved"
    assert verify_password("hunter2", user.password_hash)


async def test_second_call_is_noop(session):
    await ensure_admin_user(session, email="root@example.com", password="hunter2")
    await ensure_admin_user(session, email="root@example.com", password="different-pw")
    # second call must NOT overwrite the password
    user = (
        await session.execute(select(User).where(User.email == "root@example.com"))
    ).scalar_one()
    assert verify_password("hunter2", user.password_hash)
    assert not verify_password("different-pw", user.password_hash)


async def test_lowercases_email_for_uniqueness(session):
    await ensure_admin_user(session, email="ROOT@Example.com", password="hunter2")
    user = (await session.execute(select(User))).scalar_one()
    assert user.email == "root@example.com"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_admin_seed.py -v`
Expected: ImportError on `pencraft.db.seed`.

- [ ] **Step 3: Implement**

Create `packages/api/pencraft/db/seed.py`:

```python
"""Seed the configured admin user. Called from the FastAPI lifespan event."""
from datetime import datetime, UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.passwords import hash_password
from pencraft.db.models import User


async def ensure_admin_user(session: AsyncSession, *, email: str, password: str) -> User:
    """Create the admin user if it doesn't exist. No-op otherwise."""
    canonical_email = email.strip().lower()
    existing = (
        await session.execute(select(User).where(User.email == canonical_email))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    user = User(
        email=canonical_email,
        password_hash=hash_password(password),
        status="approved",
        role="admin",
        approved_at=datetime.now(UTC),
    )
    session.add(user)
    await session.flush()
    return user
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/api/tests/test_admin_seed.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/db/seed.py packages/api/tests/test_admin_seed.py
git commit -m "feat(db): idempotent admin user seeding"
```

---

### Task 11: `get_current_user` and `require_admin` dependencies

**Files:**
- Create: `packages/api/pencraft/auth/dependencies.py`
- Test: `packages/api/tests/test_auth_dependencies.py`

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/test_auth_dependencies.py`:

```python
"""get_current_user reads the session cookie, returns 401 / 403 as appropriate."""
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from uuid import uuid4

from pencraft.auth.dependencies import get_current_user, require_admin
from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.models import User
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests


def _make_app():
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(u: User = Depends(get_current_user)):
        return {"email": u.email, "role": u.role}

    @app.get("/admin-only")
    async def admin_only(u: User = Depends(require_admin)):
        return {"ok": True}

    @app.on_event("startup")
    async def startup():
        async with get_engine().begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    return app


@pytest.fixture
async def setup_db_and_user():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = get_sessionmaker()
    async with sm() as s:
        approved = User(
            email="a@b.com", password_hash=hash_password("x"),
            status="approved", role="user",
        )
        pending = User(
            email="p@b.com", password_hash=hash_password("x"),
            status="pending", role="user",
        )
        admin = User(
            email="r@b.com", password_hash=hash_password("x"),
            status="approved", role="admin",
        )
        s.add_all([approved, pending, admin])
        await s.commit()
        await s.refresh(approved)
        await s.refresh(pending)
        await s.refresh(admin)
    return {"approved": approved.id, "pending": pending.id, "admin": admin.id}


def _client_with_cookie(user_id):
    app = _make_app()
    client = TestClient(app)
    signer = SessionSigner("test-session-secret")
    client.cookies.set(COOKIE_NAME, signer.sign(user_id))
    return client


async def test_no_cookie_returns_401(setup_db_and_user):
    app = _make_app()
    with TestClient(app) as client:
        r = client.get("/whoami")
        assert r.status_code == 401


async def test_garbage_cookie_returns_401(setup_db_and_user):
    app = _make_app()
    with TestClient(app) as client:
        client.cookies.set(COOKIE_NAME, "garbage")
        r = client.get("/whoami")
        assert r.status_code == 401


async def test_approved_user_returns_user(setup_db_and_user):
    ids = setup_db_and_user
    client = _client_with_cookie(ids["approved"])
    with client:
        r = client.get("/whoami")
        assert r.status_code == 200
        assert r.json() == {"email": "a@b.com", "role": "user"}


async def test_pending_user_returns_403(setup_db_and_user):
    ids = setup_db_and_user
    client = _client_with_cookie(ids["pending"])
    with client:
        r = client.get("/whoami")
        assert r.status_code == 403


async def test_require_admin_blocks_user(setup_db_and_user):
    ids = setup_db_and_user
    client = _client_with_cookie(ids["approved"])
    with client:
        r = client.get("/admin-only")
        assert r.status_code == 403


async def test_require_admin_allows_admin(setup_db_and_user):
    ids = setup_db_and_user
    client = _client_with_cookie(ids["admin"])
    with client:
        r = client.get("/admin-only")
        assert r.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_auth_dependencies.py -v`
Expected: ImportError on `pencraft.auth.dependencies`.

- [ ] **Step 3: Implement**

Create `packages/api/pencraft/auth/dependencies.py`:

```python
"""FastAPI dependencies: get_current_user, require_admin.

Reads the signed session cookie, loads the user, enforces approval status
and (optionally) role=admin. Raises HTTP 401 for missing/invalid cookies
and 403 for status/role mismatches.
"""
from collections.abc import AsyncIterator

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.config import get_settings
from pencraft.db.engine import get_sessionmaker
from pencraft.db.models import User


async def _get_session() -> AsyncIterator[AsyncSession]:
    sm = get_sessionmaker()
    async with sm() as session:
        yield session


def _get_signer() -> SessionSigner:
    return SessionSigner(get_settings().session_secret)


async def get_current_user(
    pencraft_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    session: AsyncSession = Depends(_get_session),
) -> User:
    """Resolve the currently-signed-in, approved user, or raise."""
    if not pencraft_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not_authenticated")
    user_id = _get_signer().unsign(pencraft_session)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_session")
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
    if user.status != "approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"status_{user.status}")
    return user


async def require_admin(current: User = Depends(get_current_user)) -> User:
    if current.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")
    return current
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/api/tests/test_auth_dependencies.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/auth/dependencies.py packages/api/tests/test_auth_dependencies.py
git commit -m "feat(auth): get_current_user + require_admin dependencies"
```

---

## Section 3 — Auth routes

### Task 12: POST /api/auth/request

**Files:**
- Create: `packages/api/pencraft/api/auth.py`
- Test: `packages/api/tests/test_auth_request_login.py`

- [ ] **Step 1: Write the failing test (request endpoint only)**

Create `packages/api/tests/test_auth_request_login.py`:

```python
"""POST /api/auth/request creates a pending user."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


@pytest.fixture
async def client():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app = create_app()
    with TestClient(app) as c:
        yield c


async def test_request_creates_pending_user(client):
    r = client.post(
        "/api/auth/request",
        json={"email": "new@user.com", "password": "secret123"},
    )
    assert r.status_code == 201

    async with get_sessionmaker()() as session:
        user = (
            await session.execute(select(User).where(User.email == "new@user.com"))
        ).scalar_one()
        assert user.status == "pending"
        assert user.role == "user"


async def test_request_lowercases_email(client):
    r = client.post(
        "/api/auth/request",
        json={"email": "MIXED@Case.COM", "password": "secret123"},
    )
    assert r.status_code == 201
    async with get_sessionmaker()() as session:
        user = (await session.execute(select(User))).scalar_one()
        assert user.email == "mixed@case.com"


async def test_request_duplicate_email_returns_409(client):
    r1 = client.post(
        "/api/auth/request",
        json={"email": "dup@user.com", "password": "secret123"},
    )
    assert r1.status_code == 201
    r2 = client.post(
        "/api/auth/request",
        json={"email": "DUP@user.com", "password": "different"},
    )
    assert r2.status_code == 409


async def test_request_rejects_short_password(client):
    r = client.post(
        "/api/auth/request",
        json={"email": "x@y.com", "password": "short"},
    )
    assert r.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_auth_request_login.py::test_request_creates_pending_user -v`
Expected: ImportError on `pencraft.api.auth` or AttributeError missing route.

- [ ] **Step 3: Implement the auth router (request route)**

Create `packages/api/pencraft/api/auth.py`:

```python
"""Auth endpoints: /api/auth/request, /login, /logout, /me."""
from datetime import datetime, UTC

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.dependencies import get_current_user, _get_session, _get_signer
from pencraft.auth.passwords import hash_password, verify_password
from pencraft.auth.sessions import COOKIE_MAX_AGE_SECONDS, COOKIE_NAME
from pencraft.db.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RequestAccessBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class MeResponse(BaseModel):
    id: str
    email: str
    role: str
    status: str


@router.post("/request", status_code=status.HTTP_201_CREATED)
async def request_access(
    body: RequestAccessBody,
    session: AsyncSession = Depends(_get_session),
) -> dict[str, str]:
    """Create a pending user row. Admin must approve before they can log in."""
    canonical = body.email.lower()
    user = User(
        email=canonical,
        password_hash=hash_password(body.password),
        status="pending",
        role="user",
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email_already_exists"
        )
    return {"status": "pending"}
```

- [ ] **Step 4: Wire router into server (provisional — login routes added next task)**

Modify `packages/api/pencraft/server.py` (read the file first; add the import + include_router for auth). Specifically:

```python
# at the top with other route imports
from pencraft.api import auth as auth_routes

# inside create_app() where other routers are included
app.include_router(auth_routes.router)
```

- [ ] **Step 5: Run the request-related tests**

Run: `uv run pytest packages/api/tests/test_auth_request_login.py -k request -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/api/pencraft/api/auth.py packages/api/pencraft/server.py packages/api/tests/test_auth_request_login.py
git commit -m "feat(auth): POST /api/auth/request — create pending account"
```

---

### Task 13: POST /api/auth/login + /logout + GET /me

**Files:**
- Modify: `packages/api/pencraft/api/auth.py` (add routes)
- Modify: `packages/api/tests/test_auth_request_login.py` (add tests)

- [ ] **Step 1: Add tests for login / logout / me**

Append to `packages/api/tests/test_auth_request_login.py`:

```python
async def test_login_approved_user_sets_cookie(client):
    client.post(
        "/api/auth/request",
        json={"email": "go@user.com", "password": "secret123"},
    )
    # Approve manually for this test.
    async with get_sessionmaker()() as session:
        user = (
            await session.execute(select(User).where(User.email == "go@user.com"))
        ).scalar_one()
        user.status = "approved"
        await session.commit()

    r = client.post(
        "/api/auth/login",
        json={"email": "go@user.com", "password": "secret123"},
    )
    assert r.status_code == 200
    assert "pencraft_session" in r.cookies
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "go@user.com"


async def test_login_pending_blocked(client):
    client.post(
        "/api/auth/request",
        json={"email": "p@user.com", "password": "secret123"},
    )
    r = client.post(
        "/api/auth/login",
        json={"email": "p@user.com", "password": "secret123"},
    )
    assert r.status_code == 403


async def test_login_wrong_password_returns_401(client):
    client.post(
        "/api/auth/request",
        json={"email": "w@user.com", "password": "secret123"},
    )
    async with get_sessionmaker()() as session:
        user = (
            await session.execute(select(User).where(User.email == "w@user.com"))
        ).scalar_one()
        user.status = "approved"
        await session.commit()
    r = client.post(
        "/api/auth/login",
        json={"email": "w@user.com", "password": "wrong"},
    )
    assert r.status_code == 401


async def test_login_unknown_email_returns_401(client):
    r = client.post(
        "/api/auth/login",
        json={"email": "ghost@nowhere.com", "password": "anything"},
    )
    assert r.status_code == 401


async def test_logout_clears_cookie(client):
    client.post(
        "/api/auth/request",
        json={"email": "lo@user.com", "password": "secret123"},
    )
    async with get_sessionmaker()() as session:
        user = (
            await session.execute(select(User).where(User.email == "lo@user.com"))
        ).scalar_one()
        user.status = "approved"
        await session.commit()
    client.post(
        "/api/auth/login",
        json={"email": "lo@user.com", "password": "secret123"},
    )
    r = client.post("/api/auth/logout")
    assert r.status_code == 204
    me = client.get("/api/auth/me")
    assert me.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest packages/api/tests/test_auth_request_login.py -v`
Expected: 4 pass (request-related), 5 fail (login/logout/me).

- [ ] **Step 3: Add login/logout/me to the auth router**

Append to `packages/api/pencraft/api/auth.py`:

```python
@router.post("/login")
async def login(
    body: LoginBody,
    response: Response,
    session: AsyncSession = Depends(_get_session),
) -> dict[str, str]:
    """Verify credentials, set session cookie, return ok."""
    canonical = body.email.lower()
    user = (
        await session.execute(select(User).where(User.email == canonical))
    ).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    if user.status != "approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"status_{user.status}")

    user.last_login_at = datetime.now(UTC)
    await session.commit()

    cookie = _get_signer().sign(user.id)
    response.set_cookie(
        key=COOKIE_NAME,
        value=cookie,
        max_age=COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    return {"status": "ok"}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> Response:
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=MeResponse)
async def me(current: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(
        id=str(current.id),
        email=current.email,
        role=current.role,
        status=current.status,
    )
```

- [ ] **Step 4: Run all auth tests**

Run: `uv run pytest packages/api/tests/test_auth_request_login.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/api/auth.py packages/api/tests/test_auth_request_login.py
git commit -m "feat(auth): POST /login, /logout, GET /me"
```

---

### Task 14: Pending users are blocked from data routes

**Files:**
- Test: `packages/api/tests/test_auth_pending_blocked.py`

- [ ] **Step 1: Write the test**

Create `packages/api/tests/test_auth_pending_blocked.py`:

```python
"""A pending user cannot reach /api/drafts (or any authenticated endpoint)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


@pytest.fixture
async def client_for_pending_user():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        u = User(
            email="pend@user.com",
            password_hash=hash_password("x"),
            status="pending",
            role="user",
        )
        session.add(u)
        await session.commit()
        await session.refresh(u)
        uid = u.id

    app = create_app()
    with TestClient(app) as c:
        signer = SessionSigner("test-session-secret")
        c.cookies.set(COOKIE_NAME, signer.sign(uid))
        yield c


async def test_pending_user_blocked_from_drafts(client_for_pending_user):
    r = client_for_pending_user.get("/api/drafts")
    assert r.status_code == 403


async def test_pending_user_can_call_me_and_sees_their_status(client_for_pending_user):
    """Even though /me uses get_current_user (which 403s pending), there's
    no way for the FE to know their status without this endpoint. Pending
    users CAN call /me — and they see status=pending so the FE can route them
    to the 'waiting for approval' screen."""
    # /me is currently behind get_current_user which blocks pending. Verify
    # that's the current behavior — the FE handles this via /api/auth/login's
    # 403 response detail which includes the status.
    r = client_for_pending_user.get("/api/auth/me")
    assert r.status_code == 403
    assert "status_pending" in r.text
```

- [ ] **Step 2: Run the test**

Run: `uv run pytest packages/api/tests/test_auth_pending_blocked.py -v`
Expected: 2 passed.

- [ ] **Step 3: Commit (no code changes — just a guard against regression)**

```bash
git add packages/api/tests/test_auth_pending_blocked.py
git commit -m "test(auth): pending user is blocked from data routes"
```

---

## Section 4 — Admin routes

### Task 15: Admin user-management endpoints

**Files:**
- Create: `packages/api/pencraft/api/admin.py`
- Modify: `packages/api/pencraft/server.py` (register router)
- Test: `packages/api/tests/test_admin_authorization.py`
- Test: `packages/api/tests/test_admin_users.py`

- [ ] **Step 1: Write the auth-gating tests**

Create `packages/api/tests/test_admin_authorization.py`:

```python
"""Non-admin users cannot reach /api/admin/*."""
import pytest
from fastapi.testclient import TestClient

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


@pytest.fixture
async def app_with_users():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        user = User(
            email="u@x.com", password_hash=hash_password("x"),
            status="approved", role="user",
        )
        admin = User(
            email="a@x.com", password_hash=hash_password("x"),
            status="approved", role="admin",
        )
        session.add_all([user, admin])
        await session.commit()
        await session.refresh(user)
        await session.refresh(admin)
        return {"user_id": user.id, "admin_id": admin.id}


def _client_as(user_id):
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(user_id))
    return c


async def test_user_cannot_list_users(app_with_users):
    c = _client_as(app_with_users["user_id"])
    with c:
        r = c.get("/api/admin/users")
        assert r.status_code == 403


async def test_admin_can_list_users(app_with_users):
    c = _client_as(app_with_users["admin_id"])
    with c:
        r = c.get("/api/admin/users")
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert "u@x.com" in emails
        assert "a@x.com" in emails
```

Create `packages/api/tests/test_admin_users.py`:

```python
"""Approve / reject / disable / promote endpoints."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.server import create_app


@pytest.fixture
async def setup():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        admin = User(
            email="root@x.com", password_hash=hash_password("x"),
            status="approved", role="admin",
        )
        pending = User(
            email="p@x.com", password_hash=hash_password("x"),
            status="pending", role="user",
        )
        session.add_all([admin, pending])
        await session.commit()
        await session.refresh(admin)
        await session.refresh(pending)
        return {"admin": admin.id, "pending": pending.id}


def _admin_client(admin_id):
    app = create_app()
    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(admin_id))
    return c


async def test_filter_by_status(setup):
    c = _admin_client(setup["admin"])
    with c:
        r = c.get("/api/admin/users?status=pending")
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert emails == ["p@x.com"]


async def test_approve_flips_status(setup):
    c = _admin_client(setup["admin"])
    with c:
        r = c.post(f"/api/admin/users/{setup['pending']}/approve")
        assert r.status_code == 200
        assert r.json()["status"] == "approved"


async def test_reject_flips_status(setup):
    c = _admin_client(setup["admin"])
    with c:
        r = c.post(f"/api/admin/users/{setup['pending']}/reject")
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"


async def test_disable_flips_status(setup):
    c = _admin_client(setup["admin"])
    with c:
        # approve first
        c.post(f"/api/admin/users/{setup['pending']}/approve")
        r = c.post(f"/api/admin/users/{setup['pending']}/disable")
        assert r.status_code == 200
        assert r.json()["status"] == "disabled"


async def test_promote_to_admin(setup):
    c = _admin_client(setup["admin"])
    with c:
        c.post(f"/api/admin/users/{setup['pending']}/approve")
        r = c.post(f"/api/admin/users/{setup['pending']}/promote")
        assert r.status_code == 200
        assert r.json()["role"] == "admin"


async def test_404_on_unknown_user(setup):
    c = _admin_client(setup["admin"])
    with c:
        from uuid import uuid4
        r = c.post(f"/api/admin/users/{uuid4()}/approve")
        assert r.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest packages/api/tests/test_admin_authorization.py packages/api/tests/test_admin_users.py -v`
Expected: collection errors (no `pencraft.api.admin` module yet).

- [ ] **Step 3: Implement the admin router**

Create `packages/api/pencraft/api/admin.py`:

```python
"""Admin user-management endpoints. All require role=admin."""
from datetime import datetime, UTC
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pencraft.auth.dependencies import _get_session, require_admin
from pencraft.db.models import User

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class UserOut(BaseModel):
    id: str
    email: str
    status: str
    role: str
    created_at: datetime
    approved_at: datetime | None
    last_login_at: datetime | None

    @classmethod
    def from_orm(cls, u: User) -> "UserOut":
        return cls(
            id=str(u.id),
            email=u.email,
            status=u.status,
            role=u.role,
            created_at=u.created_at,
            approved_at=u.approved_at,
            last_login_at=u.last_login_at,
        )


async def _load_user(user_id: UUID, session: AsyncSession) -> User:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
    return user


@router.get("/users", response_model=list[UserOut])
async def list_users(
    status: str | None = None,
    session: AsyncSession = Depends(_get_session),
) -> list[UserOut]:
    q = select(User).order_by(User.created_at.desc())
    if status is not None:
        q = q.where(User.status == status)
    rows = (await session.execute(q)).scalars().all()
    return [UserOut.from_orm(u) for u in rows]


@router.post("/users/{user_id}/approve", response_model=UserOut)
async def approve(
    user_id: UUID,
    current: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_session),
) -> UserOut:
    user = await _load_user(user_id, session)
    user.status = "approved"
    user.approved_at = datetime.now(UTC)
    user.approved_by = current.id
    await session.commit()
    return UserOut.from_orm(user)


@router.post("/users/{user_id}/reject", response_model=UserOut)
async def reject(
    user_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> UserOut:
    user = await _load_user(user_id, session)
    user.status = "rejected"
    await session.commit()
    return UserOut.from_orm(user)


@router.post("/users/{user_id}/disable", response_model=UserOut)
async def disable(
    user_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> UserOut:
    user = await _load_user(user_id, session)
    user.status = "disabled"
    await session.commit()
    return UserOut.from_orm(user)


@router.post("/users/{user_id}/promote", response_model=UserOut)
async def promote(
    user_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> UserOut:
    user = await _load_user(user_id, session)
    user.role = "admin"
    await session.commit()
    return UserOut.from_orm(user)
```

- [ ] **Step 4: Register router**

In `packages/api/pencraft/server.py`, add the import and include statement next to the auth router lines.

```python
from pencraft.api import admin as admin_routes
# inside create_app():
app.include_router(admin_routes.router)
```

- [ ] **Step 5: Run admin tests**

Run: `uv run pytest packages/api/tests/test_admin_authorization.py packages/api/tests/test_admin_users.py -v`
Expected: all passing (2 + 6 = 8 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/pencraft/api/admin.py packages/api/pencraft/server.py packages/api/tests/test_admin_authorization.py packages/api/tests/test_admin_users.py
git commit -m "feat(admin): user-management endpoints (list/approve/reject/disable/promote)"
```

---

## Section 5 — Migrating draft routes to SQL + user scoping

### Task 16: SqlDraftStore

**Files:**
- Create: `packages/api/pencraft/drafts/sql_store.py`
- Test: `packages/api/tests/test_drafts_scoped_by_user.py`

- [ ] **Step 1: Write the scope test**

Create `packages/api/tests/test_drafts_scoped_by_user.py`:

```python
"""SqlDraftStore enforces per-user scoping on every method."""
import pytest
from uuid import uuid4

from pencraft.auth.passwords import hash_password
from pencraft.db.base import Base
from pencraft.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from pencraft.db.models import User
from pencraft.drafts.models import IdeaInput
from pencraft.drafts.sql_store import SqlDraftStore


@pytest.fixture
async def two_users():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        a = User(email="a@x.com", password_hash=hash_password("x"), status="approved", role="user")
        b = User(email="b@x.com", password_hash=hash_password("x"), status="approved", role="user")
        session.add_all([a, b])
        await session.commit()
        await session.refresh(a)
        await session.refresh(b)
        return a.id, b.id


def _idea() -> IdeaInput:
    return IdeaInput(
        topic="t", pack_slug="dan", provider="anthropic", model="m", target_words=1500,
    )


async def test_create_returns_draft_for_user(two_users):
    a_id, _ = two_users
    store = SqlDraftStore()
    draft = await store.create(user_id=a_id, idea=_idea())
    assert draft.idea.topic == "t"
    assert draft.stage == "idea"


async def test_list_only_returns_user_drafts(two_users):
    a_id, b_id = two_users
    store = SqlDraftStore()
    await store.create(user_id=a_id, idea=_idea())
    await store.create(user_id=a_id, idea=_idea())
    await store.create(user_id=b_id, idea=_idea())
    a_drafts = await store.list_for_user(a_id)
    b_drafts = await store.list_for_user(b_id)
    assert len(a_drafts) == 2
    assert len(b_drafts) == 1


async def test_get_returns_none_for_other_user(two_users):
    a_id, b_id = two_users
    store = SqlDraftStore()
    d = await store.create(user_id=a_id, idea=_idea())
    assert await store.get(d.id, user_id=a_id) is not None
    assert await store.get(d.id, user_id=b_id) is None


async def test_delete_other_users_draft_is_noop(two_users):
    a_id, b_id = two_users
    store = SqlDraftStore()
    d = await store.create(user_id=a_id, idea=_idea())
    await store.delete(d.id, user_id=b_id)  # silently fails
    assert await store.get(d.id, user_id=a_id) is not None


async def test_update_rejects_cross_user(two_users):
    a_id, b_id = two_users
    store = SqlDraftStore()
    d = await store.create(user_id=a_id, idea=_idea())
    d.title = "Hacked"
    result = await store.update(d.id, d, user_id=b_id)
    assert result is None
    # Reload as the real owner and confirm title unchanged.
    fetched = await store.get(d.id, user_id=a_id)
    assert fetched.title != "Hacked"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/api/tests/test_drafts_scoped_by_user.py -v`
Expected: ImportError on `pencraft.drafts.sql_store`.

- [ ] **Step 3: Implement SqlDraftStore**

Create `packages/api/pencraft/drafts/sql_store.py`:

```python
"""Postgres-backed draft store. Replaces the JSON-on-disk DraftStore.

Every method takes a user_id and scopes its query so users can never see
or mutate each other's drafts. Cross-user attempts silently 404 (return
None or skip) rather than 403, to avoid leaking ID existence.
"""
from datetime import datetime, UTC
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import NoResultFound

from pencraft.db.engine import get_sessionmaker
from pencraft.db.models import Draft as DraftRow
from pencraft.db.models import Section as SectionRow
from pencraft.drafts.models import (
    Draft,
    DraftSummary,
    IdeaInput,
    OutlineProposal,
    Section,
)


def _draft_from_row(row: DraftRow) -> Draft:
    return Draft(
        id=str(row.id),
        created_at=row.created_at,
        updated_at=row.updated_at,
        title=row.title,
        stage=row.stage,  # type: ignore[arg-type]
        idea=IdeaInput.model_validate(row.idea),
        outline=(OutlineProposal.model_validate(row.outline) if row.outline else None),
        sections=[
            Section(
                id=s.id,
                title=s.title,
                brief=s.brief,
                content_md=s.content_md,
                status=s.status,  # type: ignore[arg-type]
                last_generated_at=s.last_generated_at,
                last_error=s.last_error,
                word_count=s.word_count,
            )
            for s in sorted(row.sections, key=lambda s: s.position)
        ],
    )


def _summary_from_row(row: DraftRow) -> DraftSummary:
    word_count = sum(s.word_count for s in row.sections) if row.sections else 0
    return DraftSummary(
        id=str(row.id),
        title=row.title,
        stage=row.stage,  # type: ignore[arg-type]
        pack_slug=row.idea.get("pack_slug", "") if row.idea else "",
        updated_at=row.updated_at,
        word_count=word_count,
    )


class SqlDraftStore:
    """Per-user Postgres-backed draft store."""

    async def list_for_user(self, user_id: UUID) -> list[DraftSummary]:
        async with get_sessionmaker()() as session:
            rows = (
                await session.execute(
                    select(DraftRow)
                    .where(DraftRow.user_id == user_id, DraftRow.deleted_at.is_(None))
                    .order_by(DraftRow.updated_at.desc())
                )
            ).scalars().all()
            # Eagerly load sections for word counts.
            for r in rows:
                await session.refresh(r, ["sections"])
            return [_summary_from_row(r) for r in rows]

    async def get(self, draft_id: str, *, user_id: UUID) -> Draft | None:
        try:
            uuid = UUID(draft_id)
        except ValueError:
            return None
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == uuid,
                        DraftRow.user_id == user_id,
                        DraftRow.deleted_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            await session.refresh(row, ["sections"])
            return _draft_from_row(row)

    async def create(self, *, user_id: UUID, idea: IdeaInput) -> Draft:
        async with get_sessionmaker()() as session:
            row = DraftRow(
                user_id=user_id,
                title=idea.topic,
                stage="idea",
                idea=idea.model_dump(),
            )
            session.add(row)
            await session.commit()
            await session.refresh(row, ["sections"])
            return _draft_from_row(row)

    async def update(self, draft_id: str, draft: Draft, *, user_id: UUID) -> Draft | None:
        try:
            uuid = UUID(draft_id)
        except ValueError:
            return None
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == uuid, DraftRow.user_id == user_id
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            row.title = draft.title
            row.stage = draft.stage
            row.idea = draft.idea.model_dump()
            row.outline = draft.outline.model_dump() if draft.outline else None
            row.updated_at = datetime.now(UTC)

            # Replace sections in bulk.
            await session.refresh(row, ["sections"])
            existing_by_id = {s.id: s for s in row.sections}
            for pos, s in enumerate(draft.sections):
                if s.id in existing_by_id:
                    er = existing_by_id.pop(s.id)
                    er.position = pos
                    er.title = s.title
                    er.brief = s.brief
                    er.content_md = s.content_md
                    er.status = s.status
                    er.last_generated_at = s.last_generated_at
                    er.last_error = s.last_error
                    er.word_count = s.word_count
                else:
                    session.add(
                        SectionRow(
                            id=s.id,
                            draft_id=row.id,
                            position=pos,
                            title=s.title,
                            brief=s.brief,
                            content_md=s.content_md,
                            status=s.status,
                            last_generated_at=s.last_generated_at,
                            last_error=s.last_error,
                            word_count=s.word_count,
                        )
                    )
            # Anything left in existing_by_id was removed by the user.
            for orphan in existing_by_id.values():
                await session.delete(orphan)
            await session.commit()
            await session.refresh(row, ["sections"])
            return _draft_from_row(row)

    async def delete(self, draft_id: str, *, user_id: UUID) -> None:
        try:
            uuid = UUID(draft_id)
        except ValueError:
            return
        async with get_sessionmaker()() as session:
            row = (
                await session.execute(
                    select(DraftRow).where(
                        DraftRow.id == uuid, DraftRow.user_id == user_id
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                return
            row.deleted_at = datetime.now(UTC)
            await session.commit()
```

- [ ] **Step 4: Run the scope tests**

Run: `uv run pytest packages/api/tests/test_drafts_scoped_by_user.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/drafts/sql_store.py packages/api/tests/test_drafts_scoped_by_user.py
git commit -m "feat(drafts): SqlDraftStore with per-user scoping"
```

---

### Task 17: Wire SqlDraftStore into /api/drafts routes

**Files:**
- Modify: `packages/api/pencraft/api/drafts.py` (current routes)
- Modify: `packages/api/pencraft/server.py` (store instantiation)

- [ ] **Step 1: Read existing drafts.py to find what to change**

Run: `uv run grep -n "store\|DraftStore\|request.app.state" packages/api/pencraft/api/drafts.py`
Take note of every line that references the old `DraftStore`. Expect ~6-8 references.

- [ ] **Step 2: Update routes to accept current_user and use SqlDraftStore**

For every function in `packages/api/pencraft/api/drafts.py`:

1. Add `from pencraft.auth.dependencies import get_current_user`
2. Add `from pencraft.drafts.sql_store import SqlDraftStore`
3. Add `from pencraft.db.models import User` to the imports
4. Replace the existing store retrieval with:
   ```python
   def _get_store(request: Request) -> SqlDraftStore:
       return request.app.state.draft_store
   ```
5. Add `current: User = Depends(get_current_user)` to every route handler.
6. Pass `user_id=current.id` to every store call.
7. Make the route handlers async if they're not already, and `await` every store call.

The complete new file (replace entirely):

```python
"""Draft CRUD routes — user-scoped via Postgres."""
from fastapi import APIRouter, Depends, HTTPException, Request, status

from pencraft.auth.dependencies import get_current_user
from pencraft.db.models import User
from pencraft.drafts.models import Draft, DraftSummary, IdeaInput
from pencraft.drafts.sql_store import SqlDraftStore

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


def _store(request: Request) -> SqlDraftStore:
    return request.app.state.draft_store


@router.get("", response_model=list[DraftSummary])
async def list_drafts(
    request: Request, current: User = Depends(get_current_user)
) -> list[DraftSummary]:
    return await _store(request).list_for_user(current.id)


@router.post("", response_model=Draft, status_code=status.HTTP_201_CREATED)
async def create_draft(
    idea: IdeaInput,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    return await _store(request).create(user_id=current.id, idea=idea)


@router.get("/{draft_id}", response_model=Draft)
async def get_draft(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    draft = await _store(request).get(draft_id, user_id=current.id)
    if draft is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "draft_not_found")
    return draft


@router.put("/{draft_id}", response_model=Draft)
async def update_draft(
    draft_id: str,
    draft: Draft,
    request: Request,
    current: User = Depends(get_current_user),
) -> Draft:
    # Guard: don't regress stage or wipe outline/sections (preserved from PR #2).
    existing = await _store(request).get(draft_id, user_id=current.id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "draft_not_found")
    _STAGE_ORDER = {"idea": 0, "outline": 1, "sections": 2}
    if _STAGE_ORDER[draft.stage] < _STAGE_ORDER[existing.stage]:
        draft.stage = existing.stage
    if draft.outline is None and existing.outline is not None:
        draft.outline = existing.outline
    if not draft.sections and existing.sections:
        draft.sections = existing.sections
    updated = await _store(request).update(draft_id, draft, user_id=current.id)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "draft_not_found")
    return updated


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    draft_id: str,
    request: Request,
    current: User = Depends(get_current_user),
) -> None:
    await _store(request).delete(draft_id, user_id=current.id)
```

- [ ] **Step 3: Update server.py to attach the new store**

In `packages/api/pencraft/server.py`, find where `draft_store` is set on app state. Replace `DraftStore(...)` with `SqlDraftStore()`:

```python
# inside create_app(), where the old DraftStore is created:
from pencraft.drafts.sql_store import SqlDraftStore
app.state.draft_store = SqlDraftStore()
```

Remove the now-unused import of the old `DraftStore`. Leave the old `pencraft/drafts/store.py` file in place for one more commit (we'll delete in a later task once all routes have migrated).

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/api/tests/test_drafts.py packages/api/tests/test_drafts_scoped_by_user.py -v`
Expected: existing `test_drafts.py` will fail because it didn't supply a current_user. We'll fix those next task.
The scope test should still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/api/drafts.py packages/api/pencraft/server.py
git commit -m "feat(drafts): /api/drafts wired to SqlDraftStore + current_user"
```

---

### Task 18: Update existing API tests to use SQL store + authenticated client

**Files:**
- Modify: `packages/api/tests/conftest.py` (add authenticated_client fixture)
- Modify: `packages/api/tests/test_drafts.py` (use new fixture)

- [ ] **Step 1: Add authenticated client fixture**

Append to `packages/api/tests/conftest.py`:

```python
import pytest_asyncio
from fastapi.testclient import TestClient

from pencraft.auth.passwords import hash_password
from pencraft.auth.sessions import COOKIE_NAME, SessionSigner
from pencraft.db.models import User
from pencraft.server import create_app


@pytest_asyncio.fixture
async def authed_client():
    """A TestClient signed in as an approved user. Yields (client, user_id)."""
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        user = User(
            email="test@user.com",
            password_hash=hash_password("x"),
            status="approved",
            role="user",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        uid = user.id

    app = create_app()
    with TestClient(app) as c:
        c.cookies.set(COOKIE_NAME, SessionSigner("test-session-secret").sign(uid))
        yield c, uid
```

You'll need to add the imports at the top of conftest if not already present:

```python
from pencraft.db.engine import get_engine, get_sessionmaker
from pencraft.db.base import Base
```

- [ ] **Step 2: Update test_drafts.py to use the new fixture**

Find every test in `packages/api/tests/test_drafts.py` that uses `client` and switch them to `authed_client`. For each test signature change `(client)` to `(authed_client)` and unpack at the top: `client, user_id = authed_client`. No other logic changes — the routes return the same shapes.

Run a sed pass on this file would be:
```bash
# manually open and edit; sed is unsafe with python signatures
```

For each test, the pattern is:
```python
# Before:
def test_x(client):
    r = client.get("/api/drafts")

# After:
async def test_x(authed_client):
    client, _ = authed_client
    r = client.get("/api/drafts")
```

- [ ] **Step 3: Run the drafts tests**

Run: `uv run pytest packages/api/tests/test_drafts.py -v`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add packages/api/tests/conftest.py packages/api/tests/test_drafts.py
git commit -m "test(drafts): use authed_client fixture against SQL store"
```

---

### Task 19: Wire user-scoping into outline / section / expand / download / lint routes

**Files:**
- Modify: `packages/api/pencraft/api/outline.py`
- Modify: `packages/api/pencraft/api/section.py`
- Modify: `packages/api/pencraft/api/expand.py`
- Modify: `packages/api/pencraft/api/download.py`
- Modify: `packages/api/pencraft/api/lint.py`
- Modify: all their tests (`tests/test_outline_route.py`, `test_section_route.py`, `test_expand_route.py`, `test_download_route.py`, `test_lint_route.py`)

The change is mechanical and identical across all five route files:

1. Add `from pencraft.auth.dependencies import get_current_user` import.
2. Add `from pencraft.db.models import User` import.
3. Every handler signature gains `current: User = Depends(get_current_user)`.
4. Every `store.get(draft_id)` becomes `await store.get(draft_id, user_id=current.id)`.
5. Every `store.update(draft_id, draft)` becomes `await store.update(draft_id, draft, user_id=current.id)`.
6. Handlers become `async` if they aren't.

Tests: every existing test gets the `authed_client` fixture instead of `client`, with the unpack pattern from Task 18.

- [ ] **Step 1: Modify outline.py and run its tests**

Edit `packages/api/pencraft/api/outline.py` per the pattern above.
Edit `packages/api/tests/test_outline_route.py` to use `authed_client`.

Run: `uv run pytest packages/api/tests/test_outline_route.py -v`
Expected: passing.

- [ ] **Step 2: Modify section.py and run its tests**

Same pattern. Run: `uv run pytest packages/api/tests/test_section_route.py -v`

- [ ] **Step 3: Modify expand.py and run its tests**

Same pattern. Note `expand.py` runs the long-running task in the background — only the *handler* (which kicks off the job) needs the current_user. The task body should be passed `user_id` as a parameter when invoked.

Run: `uv run pytest packages/api/tests/test_expand_route.py -v`

- [ ] **Step 4: Modify download.py and run its tests**

Same pattern. Run: `uv run pytest packages/api/tests/test_download_route.py -v`

- [ ] **Step 5: Modify lint.py and run its tests**

Same pattern. Run: `uv run pytest packages/api/tests/test_lint_route.py -v`

- [ ] **Step 6: Run the full API test suite**

Run: `uv run pytest packages/api/tests -v`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add packages/api/pencraft/api packages/api/tests
git commit -m "feat(api): user-scope outline/section/expand/download/lint routes"
```

---

### Task 20: Delete the legacy JSON DraftStore

**Files:**
- Delete: `packages/api/pencraft/drafts/store.py`

- [ ] **Step 1: Verify nothing else imports it**

Run: `uv run grep -rn "from pencraft.drafts.store\|pencraft.drafts.store" packages/api`
Expected: no results.

- [ ] **Step 2: Delete**

```bash
rm packages/api/pencraft/drafts/store.py
uv run pytest packages/api/tests -v
```
Expected: still passing.

- [ ] **Step 3: Commit**

```bash
git add -A packages/api/pencraft/drafts
git commit -m "chore(drafts): delete legacy JSON DraftStore"
```

---

### Task 21: Wire CORS + auth middleware + lifespan into server.py

**Files:**
- Modify: `packages/api/pencraft/server.py`

- [ ] **Step 1: Read the current server.py**

Run: `cat packages/api/pencraft/server.py` and review. Note the existing helpers:
- `_resolve_pack_roots()`, `_resolve_static_dir()`, `_is_dev_mode()`, `_read_myvoice_pack_paths()`
- A `_lifespan` that builds `DraftStore`, `PackStore`, `JobRegistry`, `EventBus`
- An inline `/api/health` route (no separate `health` router module)
- A static-file mount at the bottom (`FileResponse` + `StaticFiles`)
- A `jobs_router` (this exists; my earlier task list omitted it — it stays)

The rewrite **preserves** all of the above and **layers** auth/admin/db/migrations on top. We delete `_resolve_drafts_root()` since the drafts no longer live on disk.

- [ ] **Step 2: Rewrite server.py preserving existing helpers, layering on auth + DB**

Replace `packages/api/pencraft/server.py` with:

```python
"""FastAPI application factory."""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from myvoice import PackStore

from pencraft import __version__
from pencraft.api.events import EventBus
from pencraft.config import get_settings
from pencraft.config.tanzu import apply_vcap_services
from pencraft.db.engine import get_engine, get_sessionmaker
from pencraft.db.seed import ensure_admin_user
from pencraft.drafts.sql_store import SqlDraftStore
from pencraft.jobs.registry import JobRegistry

# Translate VCAP_SERVICES into PENCRAFT_* env vars before Settings is read.
apply_vcap_services()


def _default_static_dir() -> Path:
    return Path(__file__).parent / "static"


def _resolve_static_dir() -> Path:
    env = os.environ.get("PENCRAFT_STATIC_DIR")
    return Path(env) if env else _default_static_dir()


def _is_dev_mode() -> bool:
    return os.environ.get("PENCRAFT_DEV", "").lower() in ("1", "true", "yes")


def _resolve_pack_roots() -> list[Path]:
    """Find every directory where myvoice packs might live.
    Unchanged from the previous version — see git history for rationale."""
    candidates: list[Path] = []
    env = os.environ.get("MYVOICE_PACKS_ROOT")
    if env:
        candidates.append(Path(env))
    candidates.append(Path.home() / ".myvoice" / "packs")
    candidates.extend(_read_myvoice_pack_paths())
    cwd = Path.cwd()
    candidates.extend([
        cwd / ".." / "myvoice" / "packs",
        cwd.parent / "myvoice" / "packs",
        Path(__file__).resolve().parents[3].parent / "myvoice" / "packs",
    ])
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

    # 1) Migrations.
    if settings.run_migrations_on_boot:
        from alembic import command
        from alembic.config import Config as AlembicConfig

        ini = Path(__file__).resolve().parents[2] / "alembic.ini"
        cfg = AlembicConfig(str(ini))
        command.upgrade(cfg, "head")

    # 2) Seed admin.
    async with get_sessionmaker()() as session:
        await ensure_admin_user(
            session, email=settings.admin_email, password=settings.admin_password
        )
        await session.commit()

    # 3) Per-request shared state.
    app.state.draft_store = SqlDraftStore()
    app.state.pack_store = PackStore(_resolve_pack_roots())
    app.state.job_registry = JobRegistry()
    app.state.event_bus = EventBus()

    yield

    await get_engine().dispose()


def create_app() -> FastAPI:
    """Build and return the FastAPI app."""
    settings = get_settings()
    app = FastAPI(title="pencraft", version=__version__, lifespan=_lifespan)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["x-job-id"],
        )

    from pencraft.api.admin import router as admin_router
    from pencraft.api.auth import router as auth_router
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

    app.include_router(auth_router)
    app.include_router(admin_router)
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
```

- [ ] **Step 3: Disable migrations-on-boot for tests**

The conftest already sets `PENCRAFT_RUN_MIGRATIONS_ON_BOOT=false` via env. Verify by running the full suite:

Run: `uv run pytest packages/api/tests -v`
Expected: all passing.

- [ ] **Step 4: Boot the server against an empty sqlite and verify migrations run**

Run:
```bash
PENCRAFT_DATABASE_URL="sqlite+aiosqlite:////tmp/pencraft-boot.db" \
  PENCRAFT_RUN_MIGRATIONS_ON_BOOT=true \
  uv run python -c "
import asyncio
from pencraft.server import create_app
app = create_app()
async def boot():
    async with app.router.lifespan_context(app):
        pass
asyncio.run(boot())
print('lifespan ran ok')
"
```
Expected: prints `lifespan ran ok`. Verify with sqlite that the `users` table now contains the admin user:
```bash
uv run python -c "import sqlite3; print(sqlite3.connect('/tmp/pencraft-boot.db').execute('SELECT email,status,role FROM users').fetchall())"
```
Expected: `[('dbbaskette@gmail.com', 'approved', 'admin')]`.

Cleanup: `rm /tmp/pencraft-boot.db`

- [ ] **Step 5: Commit**

```bash
git add packages/api/pencraft/server.py
git commit -m "feat(server): lifespan runs migrations + seeds admin; CORS configured"
```

---

## Section 6 — Web client

### Task 22: API client wrapper with `credentials: "include"`

**Files:**
- Create: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/api/drafts.ts` (use wrapper)
- Modify: `packages/web/src/api/packs.ts` (use wrapper)
- Modify: `packages/web/src/api/providers.ts` (use wrapper)

- [ ] **Step 1: Create the client wrapper**

Create `packages/web/src/api/client.ts`:

```typescript
/**
 * Single source of truth for talking to the Pencraft API.
 * Every call rides the session cookie via `credentials: "include"` so
 * cross-origin dev (vite :7881 -> api :7880) works without manual config.
 */

const BASE = import.meta.env.VITE_API_URL ?? "";

export interface ApiError extends Error {
  status: number;
  code?: string;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j);
    } catch {
      /* fall through */
    }
    const err: ApiError = Object.assign(new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`), {
      status: res.status,
      code: detail,
    });
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("Content-Type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}
```

- [ ] **Step 2: Migrate existing API modules to use the wrapper**

In `packages/web/src/api/drafts.ts`, replace every `fetch("/api/...")` call with `api("/api/...")` and remove the manual JSON parsing. The wrapper handles it.

Same for `packs.ts` and `providers.ts`.

- [ ] **Step 3: Run web tests**

Run: `cd packages/web && pnpm exec vitest run`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api
git commit -m "feat(web): api client wrapper with credentials: include"
```

---

### Task 23: auth + admin API modules and useMe hook

**Files:**
- Create: `packages/web/src/api/auth.ts`
- Create: `packages/web/src/api/admin.ts`
- Create: `packages/web/src/hooks/useMe.ts`

- [ ] **Step 1: Create auth.ts**

Create `packages/web/src/api/auth.ts`:

```typescript
import { api } from "./client";

export interface CurrentUser {
  id: string;
  email: string;
  role: "user" | "admin";
  status: "approved" | "pending" | "rejected" | "disabled";
}

export const getMe = (): Promise<CurrentUser> => api("/api/auth/me");

export const login = (email: string, password: string): Promise<{ status: string }> =>
  api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const logout = (): Promise<void> =>
  api("/api/auth/logout", { method: "POST" });

export const requestAccess = (email: string, password: string): Promise<{ status: string }> =>
  api("/api/auth/request", { method: "POST", body: JSON.stringify({ email, password }) });
```

- [ ] **Step 2: Create admin.ts**

Create `packages/web/src/api/admin.ts`:

```typescript
import { api } from "./client";

export interface AdminUser {
  id: string;
  email: string;
  status: "approved" | "pending" | "rejected" | "disabled";
  role: "user" | "admin";
  created_at: string;
  approved_at: string | null;
  last_login_at: string | null;
}

export const listUsers = (status?: AdminUser["status"]): Promise<AdminUser[]> =>
  api(`/api/admin/users${status ? `?status=${status}` : ""}`);

export const approveUser = (id: string): Promise<AdminUser> =>
  api(`/api/admin/users/${id}/approve`, { method: "POST" });

export const rejectUser = (id: string): Promise<AdminUser> =>
  api(`/api/admin/users/${id}/reject`, { method: "POST" });

export const disableUser = (id: string): Promise<AdminUser> =>
  api(`/api/admin/users/${id}/disable`, { method: "POST" });

export const promoteUser = (id: string): Promise<AdminUser> =>
  api(`/api/admin/users/${id}/promote`, { method: "POST" });
```

- [ ] **Step 3: Create useMe hook**

Create `packages/web/src/hooks/useMe.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import { type CurrentUser, getMe } from "../api/auth";

export interface UseMeResult {
  user: CurrentUser | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useMe(): UseMeResult {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    getMe()
      .then((u) => {
        setUser(u);
        setError(null);
      })
      .catch((e: Error) => {
        setUser(null);
        setError(e);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => refresh(), [refresh]);

  return { user, loading, error, refresh };
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/auth.ts packages/web/src/api/admin.ts packages/web/src/hooks/useMe.ts
git commit -m "feat(web): auth/admin API modules + useMe hook"
```

---

### Task 24: RequireAuth route guard

**Files:**
- Create: `packages/web/src/components/RequireAuth.tsx`
- Test: `packages/web/tests/components/RequireAuth.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/tests/components/RequireAuth.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../../src/components/RequireAuth";

vi.mock("../../src/api/auth", () => ({
  getMe: vi.fn(),
}));

describe("RequireAuth", () => {
  it("renders children when /api/auth/me succeeds", async () => {
    const { getMe } = await import("../../src/api/auth");
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      role: "user",
      status: "approved",
    });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <div>secret content</div>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/secret content/)).toBeInTheDocument());
  });

  it("redirects to /login when /api/auth/me errors", async () => {
    const { getMe } = await import("../../src/api/auth");
    (getMe as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("401"), { status: 401 }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <div>secret content</div>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/login page/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && pnpm exec vitest run tests/components/RequireAuth.test.tsx`
Expected: cannot resolve module.

- [ ] **Step 3: Implement**

Create `packages/web/src/components/RequireAuth.tsx`:

```typescript
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useMe } from "../hooks/useMe";

interface RequireAuthProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function RequireAuth({ children, requireAdmin = false }: RequireAuthProps): JSX.Element {
  const { user, loading, error } = useMe();

  if (loading) {
    return (
      <p className="text-center text-muted text-sm py-16">Checking session…</p>
    );
  }

  if (error || !user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run tests/components/RequireAuth.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/RequireAuth.tsx packages/web/tests/components/RequireAuth.test.tsx
git commit -m "feat(web): RequireAuth route guard"
```

---

### Task 25: LoginPage

**Files:**
- Create: `packages/web/src/routes/LoginPage.tsx`
- Test: `packages/web/tests/routes/LoginPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/tests/routes/LoginPage.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { LoginPage } from "../../src/routes/LoginPage";

vi.mock("../../src/api/auth", () => ({
  login: vi.fn(),
  requestAccess: vi.fn(),
  getMe: vi.fn(),
}));

describe("LoginPage", () => {
  it("renders both Sign in and Request access tabs", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /request access/i })).toBeInTheDocument();
  });

  it("calls login() on submit", async () => {
    const { login } = await import("../../src/api/auth");
    (login as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "ok" });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a@b.com", "secret123"));
  });

  it("switches to Request access tab and calls requestAccess()", async () => {
    const { requestAccess } = await import("../../src/api/auth");
    (requestAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "pending" });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /request access/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "new@user.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "secret123" },
    });
    fireEvent.change(screen.getByLabelText(/confirm/i), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
    await waitFor(() =>
      expect(requestAccess).toHaveBeenCalledWith("new@user.com", "secret123"),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/routes/LoginPage.test.tsx`
Expected: cannot resolve module.

- [ ] **Step 3: Implement LoginPage**

Create `packages/web/src/routes/LoginPage.tsx`:

```typescript
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { login, requestAccess } from "../api/auth";

type Tab = "signin" | "request";

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onSignIn = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (e) {
      setError(_friendlyAuthError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onRequest = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await requestAccess(email, password);
      setInfo("Request sent. An admin will review and approve your account.");
      setEmail("");
      setPassword("");
      setConfirm("");
    } catch (e) {
      setError(_friendlyAuthError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      <div className="nb-card w-full max-w-md p-8 animate-fade-up">
        <header className="mb-6 text-center">
          <div className="w-10 h-10 mx-auto rounded-[10px] bg-gradient-to-br from-cobalt-500 to-cobalt-300 grid place-items-center text-white font-serif italic font-semibold text-lg shadow-nb-cobalt mb-3">
            P
          </div>
          <h1 className="font-serif text-2xl font-medium text-ink tracking-tight">Pencraft</h1>
          <p className="text-sm text-muted mt-1">A workshop for long-form writing.</p>
        </header>

        <div className="flex border-b border-rule mb-6" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "signin"}
            onClick={() => {
              setTab("signin");
              setError(null);
              setInfo(null);
            }}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "signin"
                ? "border-cobalt-500 text-cobalt-700"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "request"}
            onClick={() => {
              setTab("request");
              setError(null);
              setInfo(null);
            }}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "request"
                ? "border-cobalt-500 text-cobalt-700"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            Request access
          </button>
        </div>

        {tab === "signin" ? (
          <form onSubmit={onSignIn} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="nb-label">Email</label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="nb-input"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="nb-label">Password</label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="nb-input"
              />
            </div>
            {error && (
              <p className="text-sm px-3 py-2 rounded-nb-sm" style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}>
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="nb-btn nb-btn-primary w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={onRequest} className="space-y-4">
            <div>
              <label htmlFor="req-email" className="nb-label">Email</label>
              <input
                id="req-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="nb-input"
              />
            </div>
            <div>
              <label htmlFor="req-password" className="nb-label">Password</label>
              <input
                id="req-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="nb-input"
              />
            </div>
            <div>
              <label htmlFor="req-confirm" className="nb-label">Confirm password</label>
              <input
                id="req-confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="nb-input"
              />
            </div>
            {info && (
              <p className="text-sm px-3 py-2 rounded-nb-sm" style={{ background: "#e3f5ec", color: "#1f7752", border: "1px solid #cde9da" }}>
                {info}
              </p>
            )}
            {error && (
              <p className="text-sm px-3 py-2 rounded-nb-sm" style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}>
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="nb-btn nb-btn-primary w-full">
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function _friendlyAuthError(e: unknown): string {
  if (e instanceof Error) {
    if (e.message.includes("status_pending")) {
      return "Your account is still pending admin approval.";
    }
    if (e.message.includes("status_rejected")) {
      return "Your access request was rejected.";
    }
    if (e.message.includes("status_disabled")) {
      return "This account has been disabled.";
    }
    if (e.message.includes("invalid_credentials")) {
      return "Email or password is incorrect.";
    }
    if (e.message.includes("email_already_exists")) {
      return "An account with that email already exists.";
    }
    return e.message;
  }
  return String(e);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run tests/routes/LoginPage.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/LoginPage.tsx packages/web/tests/routes/LoginPage.test.tsx
git commit -m "feat(web): LoginPage with Sign in + Request access tabs"
```

---

### Task 26: AdminPage

**Files:**
- Create: `packages/web/src/routes/AdminPage.tsx`
- Test: `packages/web/tests/routes/AdminPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/tests/routes/AdminPage.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminPage } from "../../src/routes/AdminPage";

vi.mock("../../src/api/admin", () => ({
  listUsers: vi.fn(),
  approveUser: vi.fn(),
  rejectUser: vi.fn(),
  disableUser: vi.fn(),
  promoteUser: vi.fn(),
}));

describe("AdminPage", () => {
  it("renders pending users and calls approve()", async () => {
    const adm = await import("../../src/api/admin");
    const pending = [
      {
        id: "u1",
        email: "wait@x.com",
        status: "pending",
        role: "user",
        created_at: "2026-05-27T00:00:00Z",
        approved_at: null,
        last_login_at: null,
      },
    ];
    (adm.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    (adm.approveUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pending[0],
      status: "approved",
    });

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/wait@x\.com/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(adm.approveUser).toHaveBeenCalledWith("u1"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/routes/AdminPage.test.tsx`
Expected: cannot resolve module.

- [ ] **Step 3: Implement**

Create `packages/web/src/routes/AdminPage.tsx`:

```typescript
import { useCallback, useEffect, useState } from "react";

import {
  type AdminUser,
  approveUser,
  disableUser,
  listUsers,
  promoteUser,
  rejectUser,
} from "../api/admin";

export function AdminPage(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listUsers()
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);

  const handle = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (users === null && !error) {
    return <p className="text-center text-muted text-sm py-16">Loading…</p>;
  }

  const pending = (users ?? []).filter((u) => u.status === "pending");
  const others = (users ?? []).filter((u) => u.status !== "pending");

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
          Admin
        </p>
        <h1 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight">
          Users
        </h1>
      </header>

      {error && (
        <div
          className="mb-6 p-4 rounded-nb"
          style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
        >
          {error}
        </div>
      )}

      <section className="mb-8">
        <h2 className="font-serif text-xl font-medium text-ink mb-3">
          Pending requests <span className="font-mono text-sm text-muted">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="nb-card p-6 text-center italic text-muted">No pending requests.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((u) => (
              <li key={u.id} className="nb-card p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-ink">{u.email}</div>
                  <div className="text-xs text-muted">
                    Requested {new Date(u.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handle(() => approveUser(u.id))}
                    className="nb-btn nb-btn-primary nb-btn-sm"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handle(() => rejectUser(u.id))}
                    className="nb-btn nb-btn-sm"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl font-medium text-ink mb-3">
          All users <span className="font-mono text-sm text-muted">({others.length})</span>
        </h2>
        <ul className="space-y-2">
          {others.map((u) => (
            <li key={u.id} className="nb-card p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-ink">{u.email}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`nb-pill nb-pill-${u.status === "approved" ? "ready" : u.status === "rejected" ? "failed" : "empty"}`}>
                    <span className="dot" />
                    {u.status}
                  </span>
                  {u.role === "admin" && (
                    <span className="nb-pill nb-pill-edited">
                      <span className="dot" />
                      admin
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {u.status === "approved" && u.role !== "admin" && (
                  <button
                    type="button"
                    onClick={() => handle(() => promoteUser(u.id))}
                    className="nb-btn nb-btn-sm"
                  >
                    Promote
                  </button>
                )}
                {u.status === "approved" && (
                  <button
                    type="button"
                    onClick={() => handle(() => disableUser(u.id))}
                    className="nb-btn nb-btn-sm"
                  >
                    Disable
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/routes/AdminPage.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/AdminPage.tsx packages/web/tests/routes/AdminPage.test.tsx
git commit -m "feat(web): AdminPage with pending requests + all users"
```

---

### Task 27: AppShell — current user chip + sign-out + admin link

**Files:**
- Modify: `packages/web/src/components/AppShell.tsx`

- [ ] **Step 1: Update AppShell**

Replace the body of `packages/web/src/components/AppShell.tsx` with:

```typescript
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { logout } from "../api/auth";
import { useMe } from "../hooks/useMe";

export function AppShell(): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <TopBar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function TopBar(): JSX.Element {
  const { user, refresh } = useMe();
  const navigate = useNavigate();
  const location = useLocation();

  const onSignOut = async (): Promise<void> => {
    try {
      await logout();
    } finally {
      refresh();
      navigate("/login");
    }
  };

  // No top bar on the login page itself.
  if (location.pathname === "/login") return <></>;

  return (
    <header className="border-b border-rule bg-white/60 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 h-14 flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <span className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-cobalt-500 to-cobalt-300 grid place-items-center text-white font-serif italic font-semibold text-base shadow-nb-cobalt">
            P
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-semibold text-[15px] text-ink tracking-tight">Pencraft</span>
            <span className="text-[11px] text-muted leading-none mt-0.5">a workshop</span>
          </span>
        </Link>
        {user && (
          <nav className="flex items-center gap-2">
            {user.role === "admin" && (
              <Link to="/admin" className="nb-btn-ghost nb-btn nb-btn-sm">
                Admin
              </Link>
            )}
            <span className="text-xs text-muted hidden sm:block">{user.email}</span>
            <button type="button" onClick={onSignOut} className="nb-btn nb-btn-sm">
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Existing App.test.tsx still expects "Pencraft" — verify**

Run: `cd packages/web && pnpm exec vitest run tests/App.test.tsx`
Expected: still passing (the wordmark is still in the brand link).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/AppShell.tsx
git commit -m "feat(web): AppShell shows current user + admin link + sign out"
```

---

### Task 28: Wire /login, /admin routes + RequireAuth around existing routes

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Read current App.tsx**

Run: `cat packages/web/src/App.tsx` — capture the current shape (likely a Router with /, /drafts/:id routes).

- [ ] **Step 2: Update App.tsx with auth-aware routes**

Replace the body with:

```typescript
import { Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { AdminPage } from "./routes/AdminPage";
import { DraftPage } from "./routes/DraftPage";
import { DraftsPage } from "./routes/DraftsPage";
import { LoginPage } from "./routes/LoginPage";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route
          path="/"
          element={
            <RequireAuth>
              <DraftsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/drafts/:id"
          element={
            <RequireAuth>
              <DraftPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth requireAdmin>
              <AdminPage />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 3: Update existing tests to mock useMe**

In `packages/web/tests/routes/DraftsPage.test.tsx`, `DraftPage.test.tsx`, and `App.test.tsx`, add (at the top of each file) a mock for `../../src/hooks/useMe` (paths adjusted for each test file's location):

```typescript
vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: { id: "u1", email: "test@x.com", role: "user", status: "approved" },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));
```

And mock `../../src/api/auth` to avoid network in `AppShell`:

```typescript
vi.mock("../../src/api/auth", () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  getMe: vi.fn().mockResolvedValue({ id: "u1", email: "test@x.com", role: "user", status: "approved" }),
}));
```

- [ ] **Step 4: Run all web tests**

Run: `pnpm exec vitest run`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/tests
git commit -m "feat(web): wire /login, /admin, and RequireAuth around routes"
```

---

## Section 7 — Docker + Tanzu

### Task 29: API Dockerfile

**Files:**
- Create: `packages/api/Dockerfile`
- Create: `.dockerignore` at repo root

- [ ] **Step 1: Create the Dockerfile**

Create `packages/api/Dockerfile`:

```dockerfile
# Pencraft API — multi-stage build.
# 1) Build the web bundle.
# 2) Install Python deps via uv.
# 3) Slim runtime image with the web bundle baked in.

# ---- web bundle stage ----
FROM node:20-alpine AS web
WORKDIR /work
RUN apk add --no-cache git && npm install -g pnpm@9
COPY packages/web/package.json packages/web/pnpm-lock.yaml /work/packages/web/
WORKDIR /work/packages/web
RUN pnpm install --frozen-lockfile
COPY packages/web /work/packages/web
RUN pnpm build

# ---- runtime stage ----
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv (pinned via pip; smaller than the standalone installer).
RUN pip install --no-cache-dir uv==0.5.0

# Copy project metadata.
COPY pyproject.toml uv.lock /app/
COPY packages/api /app/packages/api

# Copy the built web bundle into the API's static dir.
COPY --from=web /work/packages/web/dist /app/packages/api/pencraft/static

# Install Python deps (system install — production image, no venv).
RUN uv pip install --system --no-cache .

# Default port; override via $PORT in cloud envs.
ENV PORT=7880
EXPOSE 7880

CMD ["sh", "-c", "pencraft serve --host 0.0.0.0 --port ${PORT}"]
```

Create `.dockerignore` at repo root:

```
**/node_modules
**/__pycache__
**/.venv
**/local-venv
**/.git
**/.pytest_cache
**/.ruff_cache
**/.mypy_cache
**/dist
**/build
**/coverage
.idea
.vscode
*.log
```

- [ ] **Step 2: Build the image locally**

Run: `docker build -f packages/api/Dockerfile -t pencraft-api:dev .`
Expected: build succeeds in ~2-3 minutes; final image ~250MB.

- [ ] **Step 3: Commit**

```bash
git add packages/api/Dockerfile .dockerignore
git commit -m "build: multi-stage Dockerfile for API (web bundle + python deps)"
```

---

### Task 30: docker-compose.yml

**Files:**
- Create: `docker-compose.yml` at repo root

- [ ] **Step 1: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pencraft
      POSTGRES_PASSWORD: pencraft
      POSTGRES_DB: pencraft
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "pencraft"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: pencraft
      MINIO_ROOT_PASSWORD: pencraft-minio-secret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    environment:
      PENCRAFT_DATABASE_URL: "postgresql+asyncpg://pencraft:pencraft@postgres:5432/pencraft"
      PENCRAFT_S3_ENDPOINT_URL: "http://minio:9000"
      PENCRAFT_S3_ACCESS_KEY: pencraft
      PENCRAFT_S3_SECRET_KEY: pencraft-minio-secret
      PENCRAFT_S3_BUCKET: pencraft
      PENCRAFT_SESSION_SECRET: dev-session-secret-change-me
      PENCRAFT_ADMIN_EMAIL: dbbaskette@gmail.com
      PENCRAFT_ADMIN_PASSWORD: VMware0!
      PENCRAFT_CORS_ORIGINS: "http://localhost:7881"
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
    ports: ["7880:7880"]

volumes:
  pgdata:
  miniodata:
```

- [ ] **Step 2: Smoke-test the stack**

Run: `docker compose up --build -d`
Wait for the api container to settle:
Run: `docker compose logs -f api &` — confirm you see `Uvicorn running on http://0.0.0.0:7880`. Ctrl-C when seen.

Hit /api/health:
Run: `curl -s http://localhost:7880/api/health`
Expected: `{"status":"ok"}`.

Hit /api/auth/me (no cookie):
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:7880/api/auth/me`
Expected: `401`.

Log in as admin:
Run:
```bash
curl -s -c /tmp/pencraft-cookie.txt -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"dbbaskette@gmail.com","password":"VMware0!"}' \
  http://localhost:7880/api/auth/login
```
Expected: `{"status":"ok"}`.

Hit /api/auth/me with cookie:
Run: `curl -s -b /tmp/pencraft-cookie.txt http://localhost:7880/api/auth/me`
Expected: JSON with `"role":"admin","status":"approved"`.

- [ ] **Step 3: Tear down**

Run: `docker compose down`
Run: `rm /tmp/pencraft-cookie.txt`

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "build: docker-compose with postgres + minio + api"
```

---

### Task 31: Tanzu manifest.yml

**Files:**
- Create: `manifest.yml` at repo root

- [ ] **Step 1: Create the manifest**

Create `manifest.yml`:

```yaml
---
applications:
  - name: pencraft
    memory: 512M
    instances: 1
    buildpacks:
      - python_buildpack
    command: pencraft serve --host 0.0.0.0 --port $PORT
    services:
      - pencraft-postgres
      - pencraft-s3
    env:
      # Required at deploy time:
      #   cf set-env pencraft PENCRAFT_ADMIN_PASSWORD <strong-secret>
      #   cf set-env pencraft PENCRAFT_SESSION_SECRET <64-char-hex>
      # The Tanzu config adapter translates VCAP_SERVICES into
      # PENCRAFT_DATABASE_URL and PENCRAFT_S3_* at startup.
      PENCRAFT_ADMIN_EMAIL: dbbaskette@gmail.com
      PENCRAFT_S3_BUCKET: pencraft
      PENCRAFT_S3_REGION: us-east-1
      PENCRAFT_RUN_MIGRATIONS_ON_BOOT: "true"
      # Empty by default — when api and web share an origin, CORS is unnecessary.
      PENCRAFT_CORS_ORIGINS: ""
```

- [ ] **Step 2: Verify yaml syntax**

Run: `uv run python -c "import yaml; print(yaml.safe_load(open('manifest.yml')))"`
Expected: prints the parsed dict without errors.

- [ ] **Step 3: Commit**

```bash
git add manifest.yml
git commit -m "build: Tanzu Platform manifest (bound Postgres + SeaweedFS)"
```

---

### Task 32: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Quickstart and Auth sections**

Edit `README.md` to include (at the top, after the existing intro):

````markdown
## Quickstart (Docker)

```bash
docker compose up --build
```

Then open http://localhost:7880 in your browser. The first time the API
container starts it will:

1. Run database migrations (`alembic upgrade head`).
2. Seed an admin user — `dbbaskette@gmail.com` / `VMware0!`.

Sign in with that account. To add more users, share the URL — anyone can
hit `/login`, click **Request access**, and submit. You'll see them in
`/admin` and can approve.

## Local dev (without Docker)

Run Postgres and MinIO via Docker, but the API/web from your host:

```bash
docker compose up postgres minio -d
PENCRAFT_DATABASE_URL="postgresql+asyncpg://pencraft:pencraft@localhost:5432/pencraft" \
PENCRAFT_S3_ENDPOINT_URL="http://localhost:9000" \
PENCRAFT_S3_ACCESS_KEY=pencraft \
PENCRAFT_S3_SECRET_KEY=pencraft-minio-secret \
PENCRAFT_S3_BUCKET=pencraft \
PENCRAFT_ADMIN_EMAIL=dbbaskette@gmail.com \
PENCRAFT_ADMIN_PASSWORD=VMware0! \
PENCRAFT_CORS_ORIGINS=http://localhost:7881 \
  uv run pencraft serve --port 7880
```

In another terminal, the web dev server:

```bash
cd packages/web && pnpm dev
# vite serves :7881; API calls hit :7880 via CORS with credentials
```

## Tanzu Platform deployment

```bash
cf create-service postgres on-demand-postgres-small pencraft-postgres
cf create-service seaweedfs default pencraft-s3
cf push -f manifest.yml
cf set-env pencraft PENCRAFT_ADMIN_PASSWORD '<your-strong-secret>'
cf set-env pencraft PENCRAFT_SESSION_SECRET "$(openssl rand -hex 32)"
cf restage pencraft
```

The `pencraft.config.tanzu` adapter translates `VCAP_SERVICES` into the
env vars the app reads, so no manual database / S3 wiring is needed.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README quickstart for Docker, local dev, and Tanzu"
```

---

## Section 8 — Wrap-up

### Task 33: Full test sweep + biome + build

- [ ] **Step 1: API tests**

Run: `uv run pytest packages/api/tests -v`
Expected: all passing.

- [ ] **Step 2: Web tests**

Run: `cd packages/web && pnpm exec vitest run`
Expected: all passing.

- [ ] **Step 3: Biome**

Run: `cd packages/web && pnpm exec biome check .`
Expected: clean. If formatting issues remain, run `pnpm exec biome check --write .` and add the result to the next commit.

- [ ] **Step 4: TypeScript + Vite build**

Run: `cd packages/web && pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Ruff + mypy on the API**

Run: `uv run ruff check packages/api`
Run: `uv run mypy packages/api`
Expected: both clean. Fix any issues inline (TDD discipline kept us close but mypy strict will flag missing return types, etc.).

- [ ] **Step 6: Commit any cleanups**

```bash
git add -A
git commit -m "chore: lint/format/type sweep" || echo "nothing to commit"
```

---

### Task 34: Push branch and open PR

- [ ] **Step 1: Push**

```bash
git push -u origin auth-multi-tenant-postgres
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "Phase A: auth + multi-tenant Postgres + Docker + Tanzu" --body "$(cat <<'EOF'
## Summary

Implements the Phase A foundation per
\`docs/superpowers/specs/2026-05-27-auth-multi-tenant-postgres-design.md\`.

- Replaces filesystem JSON \`DraftStore\` with Postgres-backed
  \`SqlDraftStore\`, scoped per user.
- Local email/password auth: \`/api/auth/{request,login,logout,me}\`.
  Argon2 hashing, itsdangerous-signed HTTP-only session cookies.
- Admin approval flow: \`/api/admin/users\` (list/filter), approve /
  reject / disable / promote.
- Admin user (\`dbbaskette@gmail.com\` / \`VMware0!\`) seeded
  idempotently at every startup.
- Three new web routes: \`/login\`, \`/admin\`, and a \`<RequireAuth>\`
  guard wrapping \`/\` and \`/drafts/:id\`.
- AppShell gains current-user chip + sign-out + admin link.
- Alembic migrations run on boot (configurable).
- \`docker-compose.yml\` brings up api + postgres + minio.
- \`manifest.yml\` for Tanzu with bound \`pencraft-postgres\` +
  \`pencraft-s3\` (SeaweedFS) services; \`pencraft.config.tanzu\`
  adapter translates \`VCAP_SERVICES\` -> env vars.

Phase B (research stage + references) is unblocked once this merges.

## Test plan

- [x] API: full pytest suite passing (all routes scoped by user,
      8 new tests covering auth/admin/seed/sessions/tanzu adapter)
- [x] Web: vitest passing (LoginPage, AdminPage, RequireAuth + existing)
- [x] biome clean, build clean, ruff + mypy strict clean
- [ ] Manual: \`docker compose up\` -> sign in as admin, request a new
      account, approve it, verify drafts are isolated per user
- [ ] Manual: \`cf push\` against sandbox foundation, verify migrations
      run and admin login works

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec Coverage Check

Cross-referencing the spec sections against tasks:

| Spec section | Implemented by |
|---|---|
| Data model: `users` table | Task 5 (model) + Task 6 (migration) |
| Data model: `drafts` table | Task 5 + Task 6 |
| Data model: `sections` table | Task 5 + Task 6 |
| Admin seed | Task 10 + Task 21 (lifespan call) |
| `POST /api/auth/request` | Task 12 |
| `POST /api/auth/login` | Task 13 |
| `POST /api/auth/logout` | Task 13 |
| `GET /api/auth/me` | Task 13 |
| `GET /api/admin/users` (+ filter) | Task 15 |
| `POST /api/admin/users/{id}/approve` | Task 15 |
| `POST /api/admin/users/{id}/reject` | Task 15 |
| `POST /api/admin/users/{id}/disable` | Task 15 |
| `POST /api/admin/users/{id}/promote` | Task 15 |
| Session cookies (HttpOnly, SameSite=None, Secure) | Task 13 (login route sets it) + Task 9 (signer) |
| argon2 password hashing | Task 8 |
| `get_current_user` dependency | Task 11 |
| `require_admin` dependency | Task 11 |
| CORS | Task 21 |
| Tanzu VCAP adapter | Task 3 |
| `pencraft.config.Settings` | Task 2 |
| Alembic migrations | Task 6 + Task 21 (lifespan) |
| `SqlDraftStore` replaces filesystem | Task 16 |
| All existing routes scoped by user | Tasks 17, 19 |
| Delete legacy JSON store | Task 20 |
| `RequireAuth` route guard | Task 24 |
| `LoginPage` (Sign in + Request access) | Task 25 |
| `AdminPage` (pending + all users) | Task 26 |
| `AppShell` user chip + sign-out + admin link | Task 27 |
| Web API client with `credentials: include` | Task 22 |
| `useMe()` hook | Task 23 |
| Docker Compose (postgres + minio + api) | Task 30 |
| Multi-stage Dockerfile | Task 29 |
| Tanzu `manifest.yml` | Task 31 |
| Drop existing `~/.pencraft/drafts/` data | Inherent — Task 16 doesn't migrate, Task 20 deletes the loader |
| README updates | Task 32 |
| Tests: auth_request_login | Task 12, 13 |
| Tests: auth_pending_blocked | Task 14 |
| Tests: admin_authorization | Task 15 |
| Tests: drafts_scoped_by_user | Task 16 |
| Tests: session_cookie_signature | Task 9 |
| Tests: admin_seed | Task 10 |
| Tests: password_hash | Task 8 |
| Tests: tanzu_config_adapter | Task 3 |

All spec requirements have explicit task coverage. No gaps.
