"""LinkedInConnection + LinkedInPost ORM models persist and cascade."""
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from pencraft.db.base import Base
from pencraft.db.models import Draft, LinkedInConnection, LinkedInPost, User


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s
    await engine.dispose()


async def _user(session, email="li@x.com") -> User:
    u = User(email=email, password_hash="x", status="approved", role="user")
    session.add(u)
    await session.flush()
    return u


async def test_connection_round_trips(session):
    u = await _user(session)
    conn = LinkedInConnection(
        user_id=u.id,
        member_urn="urn:li:person:abc123",
        member_name="Dan B",
        encrypted_access_token="cipher-token",
        scope="openid profile w_member_social",
        expires_at=datetime.now(UTC),
    )
    session.add(conn)
    await session.commit()

    row = (
        await session.execute(
            select(LinkedInConnection).where(LinkedInConnection.user_id == u.id)
        )
    ).scalar_one()
    assert row.member_urn == "urn:li:person:abc123"
    assert row.encrypted_access_token == "cipher-token"


async def test_one_connection_per_user(session):
    u = await _user(session)
    session.add(
        LinkedInConnection(
            user_id=u.id, member_urn="urn:li:person:a", member_name="A",
            encrypted_access_token="t", scope="s", expires_at=datetime.now(UTC),
        )
    )
    await session.commit()
    # Second connection for the same user violates the PK (user_id).
    session.add(
        LinkedInConnection(
            user_id=u.id, member_urn="urn:li:person:b", member_name="B",
            encrypted_access_token="t2", scope="s", expires_at=datetime.now(UTC),
        )
    )
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        await session.commit()


async def test_post_round_trips_and_links_draft(session):
    u = await _user(session)
    d = Draft(user_id=u.id, title="T", stage="sections", idea={"topic": "t"})
    session.add(d)
    await session.flush()

    post = LinkedInPost(
        id="lip-1",
        user_id=u.id,
        draft_id=d.id,
        post_urn="urn:li:share:999",
        commentary="hello world",
        posted_at=datetime.now(UTC),
        last_stats={"likes": 3, "comments": 1},
    )
    session.add(post)
    await session.commit()

    row = (
        await session.execute(select(LinkedInPost).where(LinkedInPost.id == "lip-1"))
    ).scalar_one()
    assert row.post_urn == "urn:li:share:999"
    assert row.last_stats == {"likes": 3, "comments": 1}
    assert row.draft_id == d.id


async def test_user_delete_cascades_connection_and_posts(session):
    u = await _user(session)
    d = Draft(user_id=u.id, title="T", stage="sections", idea={"topic": "t"})
    session.add(d)
    await session.flush()
    session.add(
        LinkedInConnection(
            user_id=u.id, member_urn="urn:li:person:x", member_name="X",
            encrypted_access_token="t", scope="s", expires_at=datetime.now(UTC),
        )
    )
    session.add(
        LinkedInPost(
            id="lip-x", user_id=u.id, draft_id=d.id, post_urn="urn:li:share:1",
            commentary="c", posted_at=datetime.now(UTC),
        )
    )
    await session.commit()

    await session.delete(u)
    await session.commit()

    conns = (await session.execute(select(LinkedInConnection))).scalars().all()
    posts = (await session.execute(select(LinkedInPost))).scalars().all()
    assert conns == []
    assert posts == []


async def test_draft_delete_nulls_post_draft_id(session):
    """A LinkedIn post outlives its draft — draft_id goes NULL, post stays."""
    u = await _user(session)
    d = Draft(user_id=u.id, title="T", stage="sections", idea={"topic": "t"})
    session.add(d)
    await session.flush()
    session.add(
        LinkedInPost(
            id="lip-keep", user_id=u.id, draft_id=d.id, post_urn="urn:li:share:2",
            commentary="c", posted_at=datetime.now(UTC),
        )
    )
    await session.commit()

    await session.delete(d)
    await session.commit()

    row = (
        await session.execute(select(LinkedInPost).where(LinkedInPost.id == "lip-keep"))
    ).scalar_one()
    assert row.draft_id is None
