"""Async S3 client over aiobotocore.

Wraps just the four operations the rest of the app needs (put / get /
delete / delete_prefix + a head exists-check). The aiobotocore session
is a process-wide singleton, built from Settings the first time
get_s3_client() is called. Tests use reset_s3_client_for_tests() to
flip the underlying endpoint between cases.

Reads bucket name + endpoint + creds + region from
blogforge.config.Settings so the same code paths work locally against
MinIO and on Tanzu against SeaweedFS.
"""
from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, Any

import aiobotocore.session
from botocore.exceptions import ClientError

from blogforge.config import get_settings

if TYPE_CHECKING:
    pass


class S3Error(Exception):
    """Raised when an S3 operation fails for any reason we want to surface."""


class S3Client:
    """Thin async wrapper around aiobotocore's S3 client.

    All methods take object **keys** (no bucket prefix); the bucket is
    pulled from Settings. The aiobotocore session itself is stateless
    enough to share; the client context (returned by `create_client`)
    is opened per-call. That's wasteful at scale but trivially correct
    for now — connection pooling lives inside botocore.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._bucket = settings.s3_bucket
        self._endpoint_url = settings.s3_endpoint_url
        self._access_key = settings.s3_access_key
        self._secret_key = settings.s3_secret_key
        self._region = settings.s3_region
        self._session = aiobotocore.session.get_session()

    @property
    def bucket(self) -> str:
        return self._bucket

    def _client_ctx(self) -> Any:
        return self._session.create_client(
            "s3",
            endpoint_url=self._endpoint_url,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
            region_name=self._region,
        )

    async def put_object(
        self, key: str, body: bytes, content_type: str = "application/octet-stream"
    ) -> None:
        async with self._client_ctx() as client:
            try:
                await client.put_object(
                    Bucket=self._bucket,
                    Key=key,
                    Body=body,
                    ContentType=content_type,
                )
            except ClientError as err:
                raise S3Error(f"put_object({key!r}) failed: {err}") from err

    async def get_object(self, key: str) -> bytes:
        async with self._client_ctx() as client:
            try:
                resp = await client.get_object(Bucket=self._bucket, Key=key)
            except ClientError as err:
                raise S3Error(f"get_object({key!r}) failed: {err}") from err
            async with resp["Body"] as stream:
                body: bytes = await stream.read()
                return body

    async def head_object(self, key: str) -> bool:
        async with self._client_ctx() as client:
            try:
                await client.head_object(Bucket=self._bucket, Key=key)
            except ClientError as err:
                if err.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                    return False
                # surface any other failure (permission, bad bucket, etc.)
                raise S3Error(f"head_object({key!r}) failed: {err}") from err
            return True

    async def delete_object(self, key: str) -> None:
        async with self._client_ctx() as client:
            try:
                await client.delete_object(Bucket=self._bucket, Key=key)
            except ClientError as err:
                raise S3Error(f"delete_object({key!r}) failed: {err}") from err

    async def delete_prefix(self, prefix: str) -> int:
        """Remove every object whose key starts with `prefix`. Returns count deleted."""
        deleted = 0
        async with self._client_ctx() as client:
            paginator = client.get_paginator("list_objects_v2")
            async for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
                keys = [
                    {"Key": obj["Key"]} for obj in page.get("Contents", []) or []
                ]
                if not keys:
                    continue
                try:
                    resp = await client.delete_objects(
                        Bucket=self._bucket, Delete={"Objects": keys, "Quiet": True}
                    )
                except ClientError as err:
                    raise S3Error(
                        f"delete_prefix({prefix!r}) failed: {err}"
                    ) from err
                # delete_objects returns errors per object if any
                errors = resp.get("Errors") or []
                if errors:
                    raise S3Error(
                        f"delete_prefix({prefix!r}) partial failure: {errors!r}"
                    )
                deleted += len(keys)
        return deleted


@lru_cache(maxsize=1)
def get_s3_client() -> S3Client:
    """Process-wide singleton. Cleared by reset_s3_client_for_tests()."""
    return S3Client()


def reset_s3_client_for_tests() -> None:
    """Drop the cached client so the next get_s3_client() picks up new Settings."""
    get_s3_client.cache_clear()
