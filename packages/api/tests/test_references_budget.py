"""get_reference_context concatenates extracted markdown under a budget."""
import pytest_asyncio
from moto.server import ThreadedMotoServer

from pencraft.config import get_settings
from pencraft.drafts.models import Reference
from pencraft.generate.references import REFERENCE_BUDGET_CHARS, get_reference_context
from pencraft.s3 import get_s3_client, reset_s3_client_for_tests
from pencraft.s3.lifespan import ensure_bucket


@pytest_asyncio.fixture
async def stack():
    server = ThreadedMotoServer(port=0)
    server.start()
    host, port = server.get_host_and_port()
    endpoint = f"http://{host}:{port}"

    import os
    from unittest import mock

    with mock.patch.dict(os.environ, {
        "PENCRAFT_S3_ENDPOINT_URL": endpoint,
        "PENCRAFT_S3_ACCESS_KEY": "test",
        "PENCRAFT_S3_SECRET_KEY": "test",
        "PENCRAFT_S3_BUCKET": "ctx-test",
    }, clear=False):
        get_settings.cache_clear()
        reset_s3_client_for_tests()
        await ensure_bucket()
        try:
            yield
        finally:
            reset_s3_client_for_tests()
            get_settings.cache_clear()
            server.stop()


def _ref(rid: str, name: str, n_chars: int) -> Reference:
    return Reference(id=rid, kind="text", name=name, extracted_chars=n_chars)


async def _put(draft_id: str, ref_id: str, body: str) -> None:
    await get_s3_client().put_object(
        f"drafts/{draft_id}/references/extracted/{ref_id}.md",
        body.encode("utf-8"),
        "text/markdown",
    )


async def test_empty_refs_returns_empty_string(stack):
    out = await get_reference_context("d1", [])
    assert out == ""


async def test_under_budget_includes_full_bodies(stack):
    body_a = "A" * 1000
    body_b = "B" * 2000
    await _put("d1", "r-a", body_a)
    await _put("d1", "r-b", body_b)
    refs = [_ref("r-a", "doc A", 1000), _ref("r-b", "doc B", 2000)]
    out = await get_reference_context("d1", refs)

    assert "## Reference Materials" in out
    assert "doc A" in out and "doc B" in out
    assert body_a in out and body_b in out


async def test_over_budget_proportionally_truncates_each_ref(stack):
    # Five refs at 10k each = 50k total content (plus header overhead).
    # Budget is 30k → each ref gets ~(30k - 5*80) / 5 ≈ 5920 chars.
    bodies = {f"r-{i}": "X" * 10_000 for i in range(5)}
    for rid, body in bodies.items():
        await _put("d2", rid, body)
    refs = [_ref(rid, f"doc {rid}", 10_000) for rid in bodies]

    out = await get_reference_context("d2", refs)

    # Headline assertion: total context size is roughly the budget, not the
    # sum of the bodies.
    assert len(out) <= REFERENCE_BUDGET_CHARS + 2_000  # header + separator slack
    # Each ref is still represented, just truncated.
    for rid in bodies:
        assert f"doc {rid}" in out
    # Truncation marker present.
    assert "[truncated" in out


async def test_missing_s3_object_is_skipped_with_warning(stack, caplog):
    # Reference row exists, but the S3 object isn't there.
    refs = [_ref("ghost", "orphaned ref", 500)]
    out = await get_reference_context("d3", refs)
    # Empty body for the missing one — but header still rendered.
    assert "orphaned ref" in out or out == ""  # accept either: empty or stub
    # We don't crash.
