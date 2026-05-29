"""Reference + IdeationMessage ORM models persist and CASCADE on draft delete."""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from blogforge.db.base import Base
from blogforge.db.models import Draft, IdeationMessage, Reference, User


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s
    await engine.dispose()


async def _make_draft(session) -> Draft:
    user = User(email="u@x.com", password_hash="x", status="approved", role="user")
    session.add(user)
    await session.flush()
    draft = Draft(user_id=user.id, title="T", stage="research", idea={"topic": "t"})
    session.add(draft)
    await session.flush()
    return draft


async def test_reference_round_trips(session):
    draft = await _make_draft(session)
    ref = Reference(
        id="ref-abc",
        draft_id=draft.id,
        kind="url",
        name="example.com",
        url="https://example.com",
        extracted_chars=1234,
    )
    session.add(ref)
    await session.commit()

    fetched = (
        await session.execute(select(Reference).where(Reference.id == "ref-abc"))
    ).scalar_one()
    assert fetched.kind == "url"
    assert fetched.name == "example.com"
    assert fetched.url == "https://example.com"
    assert fetched.extracted_chars == 1234


async def test_ideation_message_round_trips_with_proposed_outline(session):
    draft = await _make_draft(session)
    msg = IdeationMessage(
        id="msg-1",
        draft_id=draft.id,
        position=0,
        role="assistant",
        content="here's an outline",
        proposed_outline={"opening_hook": "h", "sections": []},
    )
    session.add(msg)
    await session.commit()

    fetched = (
        await session.execute(select(IdeationMessage).where(IdeationMessage.id == "msg-1"))
    ).scalar_one()
    assert fetched.role == "assistant"
    assert fetched.proposed_outline == {"opening_hook": "h", "sections": []}


async def test_unique_position_per_draft(session):
    draft = await _make_draft(session)
    session.add(
        IdeationMessage(
            id="m-a", draft_id=draft.id, position=0, role="user", content="hi"
        )
    )
    session.add(
        IdeationMessage(
            id="m-b", draft_id=draft.id, position=0, role="assistant", content="hello"
        )
    )
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        await session.commit()


async def test_draft_delete_cascades_to_references(session):
    draft = await _make_draft(session)
    session.add(
        Reference(
            id="ref-x", draft_id=draft.id, kind="text", name="note", extracted_chars=10
        )
    )
    session.add(
        IdeationMessage(
            id="m-x", draft_id=draft.id, position=0, role="user", content="hi"
        )
    )
    await session.commit()

    await session.delete(draft)
    await session.commit()

    refs = (await session.execute(select(Reference))).scalars().all()
    msgs = (await session.execute(select(IdeationMessage))).scalars().all()
    assert refs == []
    assert msgs == []
