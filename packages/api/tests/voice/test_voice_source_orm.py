"""Round-trip test for VoiceSource ORM model.

Writes a VoiceSource in one session and re-reads it in a *fresh* session
(sharing one in-memory SQLite via StaticPool) to prove the rows are durable
across session boundaries.

Mirrors test_voice_models_migration.py exactly.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from blogforge.auth.passwords import hash_password
from blogforge.db.base import Base
from blogforge.db.models import User, VoiceProfile, VoiceSource


async def test_voice_source_round_trip() -> None:
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
                email="voicesource@example.com",
                password_hash=hash_password("x"),
                status="approved",
                role="user",
            )
            write.add(user)
            await write.flush()

            profile = VoiceProfile(user_id=user.id, name="My Voice", rules={})
            write.add(profile)
            await write.flush()

            source = VoiceSource(
                profile_id=profile.id,
                url="https://tanzu.vmware.com",
                name="Tanzu Docs",
                s3_key="voice/p/sources/test-source.md",
                extracted_chars=2048,
                status="ready",
            )
            write.add(source)
            await write.commit()

            profile_id = profile.id
            source_id = source.id

        # Fresh session: proves the data persisted, not just the identity map.
        async with sm() as read:
            fetched_profile = (
                await read.execute(
                    select(VoiceProfile).where(VoiceProfile.id == profile_id)
                )
            ).scalar_one()
            await read.refresh(fetched_profile, ["sources"])
            assert len(fetched_profile.sources) == 1

            fetched_source = fetched_profile.sources[0]
            assert fetched_source.id == source_id
            assert fetched_source.url == "https://tanzu.vmware.com"
            assert fetched_source.name == "Tanzu Docs"
            assert fetched_source.s3_key == "voice/p/sources/test-source.md"
            assert fetched_source.extracted_chars == 2048
            assert fetched_source.status == "ready"
            assert fetched_source.profile_id == profile_id
    finally:
        await engine.dispose()
