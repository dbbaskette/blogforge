"""Two drafts can hold sections with the same slug (composite PK)."""

import pytest

from blogforge.auth.passwords import hash_password
from blogforge.db.base import Base
from blogforge.db.engine import get_engine, get_sessionmaker, reset_engine_for_tests
from blogforge.db.models import User
from blogforge.drafts.models import IdeaInput, OutlineProposal, OutlineSection, Section
from blogforge.drafts.sql_store import SqlDraftStore


@pytest.fixture
async def user_id():
    reset_engine_for_tests()
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_sessionmaker()() as session:
        u = User(email="a@x.com", password_hash=hash_password("x"), status="approved", role="user")
        session.add(u)
        await session.commit()
        await session.refresh(u)
        return u.id


def _idea() -> IdeaInput:
    return IdeaInput(
        topic="t", pack_slug="dan", provider="anthropic", model="m", target_words=1000
    )


def _outline() -> OutlineProposal:
    # Slugs an LLM would happily reuse across drafts.
    return OutlineProposal(
        opening_hook="hook",
        sections=[
            OutlineSection(id="the-pattern", title="The Pattern", brief="b1"),
            OutlineSection(id="get-building", title="Your Turn", brief="b2"),
        ],
        estimated_words=1500,
    )


async def test_two_drafts_share_section_slugs(user_id):
    """Regression for the global-PK collision: accepting the same outline
    shape on two drafts must not violate sections_pkey."""
    store = SqlDraftStore()

    async def _seed(draft_uuid_topic: str) -> str:
        d = await store.create(user_id=user_id, idea=_idea())
        outline = _outline()
        d.outline = outline
        d.stage = "outline"
        d.sections = [Section(id=s.id, title=s.title, brief=s.brief) for s in outline.sections]
        updated = await store.update(d.id, d, user_id=user_id)
        assert updated is not None
        return updated.id

    a = await _seed("a")
    b = await _seed("b")  # same slugs — must not collide

    da = await store.get(a, user_id=user_id)
    db = await store.get(b, user_id=user_id)
    assert {s.id for s in da.sections} == {"the-pattern", "get-building"}
    assert {s.id for s in db.sections} == {"the-pattern", "get-building"}
