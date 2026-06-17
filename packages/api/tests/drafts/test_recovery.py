"""recover_stranded_sections — boot-time self-heal of stuck 'generating' rows."""
from sqlalchemy import select

from blogforge.auth.passwords import hash_password
from blogforge.db.models import Draft, Section, User
from blogforge.drafts.recovery import recover_stranded_sections


async def test_recover_stranded_sections(session) -> None:
    user = User(
        email="recover@example.com",
        password_hash=hash_password("x"),
        status="approved",
        role="user",
    )
    session.add(user)
    await session.flush()
    draft = Draft(user_id=user.id, idea={"topic": "t"})
    session.add(draft)
    await session.flush()
    session.add_all(
        [
            # stranded but has prose → should be restored to ready
            Section(
                id="with-content",
                draft_id=draft.id,
                position=0,
                title="A",
                content_md="Real generated prose lives here.",
                status="generating",
                last_error="some stale error",
            ),
            # stranded and empty → should become failed (retry-able)
            Section(
                id="empty",
                draft_id=draft.id,
                position=1,
                title="B",
                content_md="   ",
                status="generating",
            ),
            # already ready → must be left untouched
            Section(
                id="done",
                draft_id=draft.id,
                position=2,
                title="C",
                content_md="finished",
                status="ready",
            ),
        ]
    )
    await session.commit()

    reset_count = await recover_stranded_sections(session)
    assert reset_count == 2

    # Read back at column level (no ORM identity-map staleness after a bulk UPDATE).
    result = await session.execute(
        select(
            Section.id, Section.status, Section.content_md, Section.last_error
        ).where(Section.draft_id == draft.id)
    )
    rows = {r.id: r for r in result}
    # content preserved, restored to ready, stale error cleared
    assert rows["with-content"].status == "ready"
    assert rows["with-content"].content_md == "Real generated prose lives here."
    assert rows["with-content"].last_error is None
    # empty one is failed with a retry-able message
    assert rows["empty"].status == "failed"
    assert rows["empty"].last_error
    # untouched
    assert rows["done"].status == "ready"


async def test_recover_is_noop_when_nothing_stranded(session) -> None:
    user = User(
        email="noop@example.com",
        password_hash=hash_password("x"),
        status="approved",
        role="user",
    )
    session.add(user)
    await session.flush()
    draft = Draft(user_id=user.id, idea={"topic": "t"})
    session.add(draft)
    await session.flush()
    session.add(
        Section(id="s", draft_id=draft.id, position=0, title="S", content_md="x", status="ready")
    )
    await session.commit()

    assert await recover_stranded_sections(session) == 0
