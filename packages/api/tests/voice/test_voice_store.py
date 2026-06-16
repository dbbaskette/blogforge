"""SqlVoiceStore CRUD — scoped by user_id, version bumped on every mutation."""
import pytest
from uuid import uuid4

from blogforge.db.models import User
from blogforge.db.engine import get_sessionmaker
from blogforge.voice.store import SqlVoiceStore
from blogforge.voice.models import VoiceRules


async def test_get_or_create_and_mutations():
    uid = uuid4()
    async with get_sessionmaker()() as s:
        s.add(User(id=uid, email="a@b.c", password_hash="x", status="approved", role="user"))
        await s.commit()

    store = SqlVoiceStore()

    # get_or_create on a new user produces a blank profile
    p = await store.get_or_create(uid)
    assert p.name == "My Voice"
    assert p.user_id == str(uid)
    v0 = p.version

    # get_or_create again returns the same profile (no dup)
    p2 = await store.get_or_create(uid)
    assert p2.id == p.id

    # update_persona bumps version
    p3 = await store.update_persona(uid, identity="Builder", one_line="ol", tone="t")
    assert p3.persona_identity == "Builder"
    assert p3.version > v0

    # update_rules persists VoiceRules and bumps version
    p4 = await store.update_rules(uid, VoiceRules(no_em_dashes=True))
    assert p4.rules.no_em_dashes is True
    assert p4.version > p3.version

    # add_sample inserts a sample, bumps profile version
    sample = await store.add_sample(uid, kind="text", name="s", s3_key="k", extracted_chars=5)
    assert sample.id  # has an id
    assert sample.s3_key == "k"
    assert sample.exemplar is False

    # get returns full profile with samples
    p5 = await store.get(uid)
    assert p5 is not None
    assert p5.version > p4.version
    assert len(p5.samples) == 1
    assert p5.rules.no_em_dashes is True

    # set_exemplar toggles exemplar flag and bumps version
    p6 = await store.set_exemplar(uid, sample.id, True)
    assert p6.samples[0].exemplar is True

    fetched = await store.get(uid)
    assert fetched.samples[0].exemplar is True

    # delete_sample removes the sample, bumps version
    await store.delete_sample(uid, sample.id)
    p7 = await store.get(uid)
    assert p7.samples == []


async def test_set_distilled():
    uid = uuid4()
    async with get_sessionmaker()() as s:
        s.add(User(id=uid, email="b@b.c", password_hash="x", status="approved", role="user"))
        await s.commit()

    store = SqlVoiceStore()
    p = await store.get_or_create(uid)
    p2 = await store.set_distilled(uid, "## Style\nBe concise.")
    assert p2.distilled_style_md == "## Style\nBe concise."
    assert p2.distilled_at is not None
    assert p2.version > p.version


async def test_get_returns_none_for_missing_user():
    uid = uuid4()
    store = SqlVoiceStore()
    result = await store.get(uid)
    assert result is None


async def test_user_isolation():
    """Each user sees only their own profile."""
    uid_a = uuid4()
    uid_b = uuid4()
    async with get_sessionmaker()() as s:
        s.add(User(id=uid_a, email="iso_a@b.c", password_hash="x", status="approved", role="user"))
        s.add(User(id=uid_b, email="iso_b@b.c", password_hash="x", status="approved", role="user"))
        await s.commit()

    store = SqlVoiceStore()
    pa = await store.get_or_create(uid_a)
    pb = await store.get_or_create(uid_b)
    assert pa.id != pb.id

    await store.update_persona(uid_a, identity="A-identity", one_line="a", tone="t")
    fetched_b = await store.get(uid_b)
    assert fetched_b.persona_identity == ""  # B's profile untouched


async def test_cross_user_sample_isolation():
    """User B cannot delete or toggle user A's sample."""
    uid_a = uuid4()
    uid_b = uuid4()
    async with get_sessionmaker()() as s:
        s.add(User(id=uid_a, email="sa@b.c", password_hash="x", status="approved", role="user"))
        s.add(User(id=uid_b, email="sb@b.c", password_hash="x", status="approved", role="user"))
        await s.commit()

    store = SqlVoiceStore()
    await store.get_or_create(uid_b)  # B has a profile but no samples
    sample = await store.add_sample(uid_a, kind="text", name="s", s3_key="k")

    # B tries to delete A's sample → no-op
    await store.delete_sample(uid_b, sample.id)
    assert len(((await store.get(uid_a)).samples)) == 1

    # B tries to toggle A's sample → A's sample unchanged
    await store.set_exemplar(uid_b, sample.id, True)
    assert (await store.get(uid_a)).samples[0].exemplar is False


async def test_set_exemplar_invalid_uuid_fresh_user_does_not_crash():
    uid = uuid4()
    async with get_sessionmaker()() as s:
        s.add(User(id=uid, email="x@b.c", password_hash="x", status="approved", role="user"))
        await s.commit()
    store = SqlVoiceStore()
    profile = await store.set_exemplar(uid, "not-a-uuid", True)
    assert profile is not None and profile.name == "My Voice"
