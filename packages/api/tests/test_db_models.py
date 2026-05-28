"""ORM models can be created, persisted, and queried."""
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

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
    row = (
        await session.execute(select(User).where(User.email == "alice@example.com"))
    ).scalar_one()
    assert row.id is not None
    assert row.role == "user"
    assert row.status == "approved"
    assert isinstance(row.created_at, datetime)


async def test_draft_belongs_to_user(session):
    u = User(email="bob@example.com", password_hash="x", status="approved", role="user")
    session.add(u)
    await session.flush()
    d = Draft(user_id=u.id, title="Test", stage="research", idea={"topic": "Test"})
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
