"""Round-trip test for VoiceProfile + VoiceSample ORM models.

Writes in one session and re-reads in a *fresh* session (sharing one in-memory
SQLite via StaticPool) to prove the rows are durable across session boundaries.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from blogforge.auth.passwords import hash_password
from blogforge.db.base import Base
from blogforge.db.models import User, VoiceProfile, VoiceSample


async def test_voice_profile_and_sample_round_trip() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sm() as write:
            user = User(
                email="voice@example.com",
                password_hash=hash_password("x"),
                status="approved",
                role="user",
            )
            write.add(user)
            await write.flush()
            profile = VoiceProfile(user_id=user.id, name="My Voice", rules={"no_em_dashes": True})
            write.add(profile)
            await write.flush()
            write.add(
                VoiceSample(
                    profile_id=profile.id,
                    kind="url",
                    name="Sample Post",
                    s3_key="voice/samples/test-key.md",
                    exemplar=True,
                )
            )
            await write.commit()
            user_id = user.id

        # Fresh session: proves the data persisted, not just the identity map.
        async with sm() as read:
            fetched = (
                await read.execute(select(VoiceProfile).where(VoiceProfile.user_id == user_id))
            ).scalar_one()
            assert fetched.rules == {"no_em_dashes": True}
            assert fetched.name == "My Voice"
            await read.refresh(fetched, ["samples"])
            assert len(fetched.samples) == 1
            assert fetched.samples[0].exemplar is True
            assert fetched.samples[0].kind == "url"
            assert fetched.samples[0].s3_key == "voice/samples/test-key.md"
    finally:
        await engine.dispose()
