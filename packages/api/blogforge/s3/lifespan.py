"""S3 lifecycle helpers — bucket bootstrap at app startup."""
from __future__ import annotations

from botocore.exceptions import ClientError

from blogforge.s3.client import S3Error, get_s3_client


async def ensure_bucket() -> None:
    """Create the configured bucket if it doesn't exist. Idempotent.

    Called from the FastAPI lifespan after migrations + before the
    server accepts requests. On both MinIO (local) and SeaweedFS
    (Tanzu) this is the canonical create-if-missing pattern.
    """
    s3 = get_s3_client()
    async with s3._client_ctx() as client:
        try:
            await client.head_bucket(Bucket=s3.bucket)
            return  # already exists
        except ClientError as err:
            code = err.response.get("Error", {}).get("Code")
            if code not in {"404", "NoSuchBucket", "NotFound"}:
                raise S3Error(
                    f"head_bucket({s3.bucket!r}) failed: {err}"
                ) from err
            # fall through to create
        try:
            await client.create_bucket(Bucket=s3.bucket)
        except ClientError as err:
            code = err.response.get("Error", {}).get("Code")
            if code in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                return  # raced; someone else made it
            raise S3Error(
                f"create_bucket({s3.bucket!r}) failed: {err}"
            ) from err
