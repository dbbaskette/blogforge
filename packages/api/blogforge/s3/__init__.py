"""S3 / S3-compatible object storage layer (MinIO locally, SeaweedFS on Tanzu)."""
from blogforge.s3.client import (
    S3Client,
    S3Error,
    get_s3_client,
    reset_s3_client_for_tests,
)

__all__ = [
    "S3Client",
    "S3Error",
    "get_s3_client",
    "reset_s3_client_for_tests",
]
