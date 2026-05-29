"""SqlDraftStore enforces per-user scoping on every method."""
import pytest_asyncio

from blogforge.auth.passwords import hash_password
from blogforge.db.base import Base
from blogforge.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from blogforge.db.models import User
from blogforge.drafts.models import IdeaInput
from blogforge.drafts.sql_store import SqlDraftStore


@pytest_asyncio.fixture
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
    assert draft.stage == "research"


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
