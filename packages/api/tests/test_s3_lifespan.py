"""ensure_bucket() is idempotent and creates the configured bucket on first call."""
import pytest_asyncio
from moto.server import ThreadedMotoServer

from pencraft.config import get_settings
from pencraft.s3 import get_s3_client, reset_s3_client_for_tests
from pencraft.s3.lifespan import ensure_bucket


@pytest_asyncio.fixture
async def s3_endpoint():
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
        "PENCRAFT_S3_BUCKET": "lifespan-test",
        "PENCRAFT_S3_REGION": "us-east-1",
    }
    with mock.patch.dict(os.environ, env, clear=False):
        get_settings.cache_clear()
        reset_s3_client_for_tests()
        try:
            yield
        finally:
            reset_s3_client_for_tests()
            get_settings.cache_clear()
            server.stop()


async def test_ensure_bucket_creates_when_missing(s3_endpoint):
    s3 = get_s3_client()
    # Sanity: bucket doesn't exist yet — head on any key returns False even
    # without the bucket because aiobotocore's head_object 404s before checking.
    await ensure_bucket()
    # After ensure: putting an object succeeds (would have raised
    # NoSuchBucket if creation didn't happen).
    await s3.put_object("smoke.txt", b"x")
    assert await s3.head_object("smoke.txt") is True


async def test_ensure_bucket_is_idempotent(s3_endpoint):
    await ensure_bucket()
    await ensure_bucket()  # no error on the second call
    s3 = get_s3_client()
    await s3.put_object("smoke.txt", b"x")
    assert await s3.head_object("smoke.txt") is True
