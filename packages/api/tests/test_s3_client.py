"""S3Client round-trips against an in-process moto S3 server."""
import pytest
import pytest_asyncio
from moto.server import ThreadedMotoServer

from pencraft.config import get_settings
from pencraft.s3 import S3Error, get_s3_client, reset_s3_client_for_tests


@pytest_asyncio.fixture
async def s3():
    """Spin up moto's HTTP server so aiobotocore can talk to it like real S3."""
    server = ThreadedMotoServer(port=0)
    server.start()
    host, port = server.get_host_and_port()
    endpoint = f"http://{host}:{port}"

    import os
    from unittest import mock

    env = {
        "PENCRAFT_S3_ENDPOINT_URL": endpoint,
        "PENCRAFT_S3_ACCESS_KEY": "test",
        "PENCRAFT_S3_SECRET_KEY": "test",
        "PENCRAFT_S3_BUCKET": "pencraft-test",
        "PENCRAFT_S3_REGION": "us-east-1",
    }
    with mock.patch.dict(os.environ, env, clear=False):
        get_settings.cache_clear()
        reset_s3_client_for_tests()
        client = get_s3_client()

        # Create the bucket via moto.
        import aiobotocore.session

        session = aiobotocore.session.get_session()
        async with session.create_client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id="test",
            aws_secret_access_key="test",
            region_name="us-east-1",
        ) as boto:
            await boto.create_bucket(Bucket="pencraft-test")

        try:
            yield client
        finally:
            reset_s3_client_for_tests()
            get_settings.cache_clear()
            server.stop()


async def test_put_get_round_trip(s3):
    await s3.put_object("foo/bar.txt", b"hello world", "text/plain")
    body = await s3.get_object("foo/bar.txt")
    assert body == b"hello world"


async def test_head_object_missing_returns_false(s3):
    assert await s3.head_object("nope.txt") is False
    await s3.put_object("yep.txt", b"x")
    assert await s3.head_object("yep.txt") is True


async def test_delete_object(s3):
    await s3.put_object("zap.txt", b"x")
    await s3.delete_object("zap.txt")
    assert await s3.head_object("zap.txt") is False


async def test_delete_prefix_removes_all_matching(s3):
    await s3.put_object("drafts/d1/a.md", b"1")
    await s3.put_object("drafts/d1/b.md", b"2")
    await s3.put_object("drafts/d1/c/d.md", b"3")
    await s3.put_object("drafts/d2/x.md", b"x")

    count = await s3.delete_prefix("drafts/d1/")
    assert count == 3

    # d2 untouched
    assert await s3.head_object("drafts/d2/x.md") is True


async def test_get_missing_raises_s3_error(s3):
    with pytest.raises(S3Error):
        await s3.get_object("does-not-exist.txt")
