"""SqlVoiceStore source CRUD — add, list, delete; version bumps; user-scoping."""
from uuid import uuid4

from blogforge.db.engine import get_sessionmaker
from blogforge.db.models import User
from blogforge.voice.store import SqlVoiceStore


async def _make_user(email: str) -> object:
    """Insert an approved user and return its id."""
    uid = uuid4()
    async with get_sessionmaker()() as s:
        s.add(User(id=uid, email=email, password_hash="x", status="approved", role="user"))
        await s.commit()
    return uid


async def test_add_source_and_list() -> None:
    uid = await _make_user("source1@example.com")
    store = SqlVoiceStore()

    # Ensure profile first (get version baseline)
    profile = await store.get_or_create(uid)
    v0 = profile.version

    source = await store.add_source(
        uid,
        url="https://tanzu.vmware.com",
        name="Tanzu Docs",
        s3_key="voice/fake-profile/sources/abc123.md",
        extracted_chars=1000,
        status="ready",
    )

    assert source.id
    assert source.url == "https://tanzu.vmware.com"
    assert source.name == "Tanzu Docs"
    assert source.extracted_chars == 1000
    assert source.status == "ready"

    # Version should have bumped
    updated = await store.get_or_create(uid)
    assert updated.version > v0

    # list_sources should return the source
    sources = await store.list_sources(uid)
    assert len(sources) == 1
    assert sources[0].id == source.id
    assert sources[0].url == "https://tanzu.vmware.com"


async def test_delete_source_bumps_version() -> None:
    uid = await _make_user("source2@example.com")
    store = SqlVoiceStore()

    source = await store.add_source(
        uid,
        url="https://example.com",
        name="Example",
        s3_key="voice/fake/sources/def456.md",
        extracted_chars=500,
        status="ready",
    )

    before = await store.get_or_create(uid)
    v_before = before.version

    await store.delete_source(uid, source.id)

    sources = await store.list_sources(uid)
    assert sources == []

    after = await store.get_or_create(uid)
    assert after.version > v_before


async def test_delete_source_unknown_id_is_noop() -> None:
    uid = await _make_user("source3@example.com")
    store = SqlVoiceStore()

    await store.get_or_create(uid)
    # Should not raise for a non-existent source
    await store.delete_source(uid, str(uuid4()))


async def test_sources_are_user_scoped() -> None:
    uid_a = await _make_user("sourcea@example.com")
    uid_b = await _make_user("sourceb@example.com")
    store = SqlVoiceStore()

    await store.add_source(
        uid_a,
        url="https://a.com",
        name="A",
        s3_key="voice/a/sources/1.md",
        extracted_chars=100,
        status="ready",
    )

    # user B should see no sources
    sources_b = await store.list_sources(uid_b)
    assert sources_b == []

    # user A should see exactly one
    sources_a = await store.list_sources(uid_a)
    assert len(sources_a) == 1


async def test_add_multiple_sources_ordered_by_added_at() -> None:
    uid = await _make_user("source4@example.com")
    store = SqlVoiceStore()

    s1 = await store.add_source(
        uid,
        url="https://first.com",
        name="First",
        s3_key="voice/p/sources/1.md",
        status="ready",
    )
    s2 = await store.add_source(
        uid,
        url="https://second.com",
        name="Second",
        s3_key="voice/p/sources/2.md",
        status="ready",
    )

    sources = await store.list_sources(uid)
    assert len(sources) == 2
    # Ordering by added_at: first inserted should come first
    assert sources[0].id == s1.id
    assert sources[1].id == s2.id
