"""Application settings, loaded from PENCRAFT_*-prefixed env vars."""
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Single source of truth for runtime configuration.

    Defaults are aimed at local dev / tests so the suite runs without any
    environment setup. Production overrides via env vars (or via the Tanzu
    config adapter for VCAP_SERVICES-bound services).
    """

    model_config = SettingsConfigDict(
        env_prefix="PENCRAFT_",
        env_file=None,  # never auto-load .env; tests would be flaky
        extra="ignore",
    )

    database_url: str = "sqlite+aiosqlite:///:memory:"
    admin_email: str = "dbbaskette@gmail.com"
    admin_password: str = "VMware0!"
    session_secret: str = "dev-session-secret-change-me-in-prod"
    # NoDecode: skip pydantic-settings' default JSON parsing so split_csv() sees
    # the raw env string (e.g. "a,b,c") rather than a JSONDecodeError.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:7881"]
    )

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "pencraft"
    s3_secret_key: str = "pencraft-minio-secret"
    s3_bucket: str = "pencraft"
    s3_region: str = "us-east-1"

    run_migrations_on_boot: bool = True
    # Set to False in tests to skip the S3 bucket bootstrap (tests use moto
    # in-process; they don't need the lifespan's ensure_bucket() side-effect).
    s3_bootstrap_on_boot: bool = True

    # Auth cookie flags. Default False so the test suite (which talks to
    # http://testserver) can replay the session cookie. Production deploys
    # set PENCRAFT_COOKIE_SECURE=true.
    cookie_secure: bool = False
    cookie_samesite: str = "lax"  # production cross-site flows can override to "none"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_csv(cls, v: object) -> object:
        """Accept comma-separated string from env: PENCRAFT_CORS_ORIGINS=a,b,c."""
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide singleton. Cache so we don't re-parse env on every call."""
    return Settings()
