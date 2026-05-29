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

from blogforge.config import get_settings


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
