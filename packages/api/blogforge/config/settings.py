"""Application settings, loaded from BLOGFORGE_*-prefixed env vars."""

import os
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _expand_sqlite_url(url: str) -> str:
    """Expand a leading ~ in a file-based SQLite URL. SQLAlchemy/aiosqlite treat
    the path literally, so an un-expanded ~ would create a folder named '~'."""
    prefix, sep, path = url.partition(":///")
    if not sep or not path or path == ":memory:":
        return url
    return f"{prefix}:///{os.path.expanduser(path)}"


class Settings(BaseSettings):
    """Single source of truth for runtime configuration.

    Defaults are aimed at local dev / tests so the suite runs without any
    environment setup. Production overrides via env vars (or via the Tanzu
    config adapter for VCAP_SERVICES-bound services).
    """

    model_config = SettingsConfigDict(
        env_prefix="BLOGFORGE_",
        env_file=None,  # never auto-load .env; tests would be flaky
        extra="ignore",
    )

    # data_dir is the single "standard folder" all local persistence hangs off:
    # `<data_dir>/blogforge.db` (SQLite) and `<data_dir>/blobs/` (blob files).
    # Local dev needs no containers. On Tanzu the DB is bound Postgres and blobs
    # live on a bound Block Storage volume, so both defaults below are overridden
    # (via VCAP / env) and data_dir is unused. ~ is expanded in _derive_paths.
    data_dir: str = "~/.blogforge"
    # Blank -> derived from data_dir in _derive_paths(). An explicit env value
    # (operator override, or the VCAP Postgres binding on Tanzu) always wins.
    database_url: str = ""
    admin_email: str = "dbbaskette@gmail.com"
    admin_password: str = "VMware0!"
    session_secret: str = "dev-session-secret-change-me-in-prod"
    # NoDecode: skip pydantic-settings' default JSON parsing so split_csv() sees
    # the raw env string (e.g. "a,b,c") rather than a JSONDecodeError.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:7881"]
    )

    github_client_id: str = ""
    github_client_secret: str = ""
    github_admin_login: str = ""
    # Public base URL for the OAuth callback (e.g. https://blogforge.<tp-domain>).
    # Empty -> derived from the incoming request (works on localhost).
    public_url: str = ""
    github_allowlist: Annotated[list[str], NoDecode] = Field(default_factory=list)

    tanzu_api_base: str = ""
    tanzu_api_key: str = ""
    tanzu_models: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "openai/gpt-oss-120b",
            "Qwen/Qwen3.5-27B-GPTQ-Int4",
            "google/gemma-4-31B-it",
        ]
    )
    # Like s3_verify_ssl: the bound GenAI proxy presents a self-signed cert from
    # the foundation's internal CA, so config/tanzu._apply_genai flips this to
    # False for the bound gateway. Default True keeps real OpenAI strict.
    tanzu_verify_ssl: bool = True

    # Blob storage (hero images, voice samples, uploads). "fs" writes to a local
    # or mounted directory — no MinIO/Docker locally, and a bound Block Storage
    # volume on Tanzu. "s3" uses object storage (MinIO locally / SeaweedFS on
    # Tanzu). Default "fs" so the app runs with zero infra; the Tanzu adapter or
    # docker-compose flips it to "s3" when object storage is bound.
    storage_backend: Literal["fs", "s3"] = "fs"
    # Base dir for the "fs" backend. Blank -> "<data_dir>/blobs" (see
    # _derive_paths). On Tanzu the VCAP adapter sets it to the bound Block
    # Storage volume's mount path (config/tanzu._apply_volume).
    storage_dir: str = ""

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "blogforge"
    s3_secret_key: str = "blogforge-minio-secret"
    s3_bucket: str = "blogforge"
    s3_region: str = "us-east-1"
    # Verify the S3 endpoint's TLS certificate. Default True (secure). The
    # Tanzu/CF SeaweedFS gateway presents a self-signed cert from the
    # foundation's internal CA (not in the container trust store), so
    # config/tanzu._apply_s3 flips this to False for the bound instance.
    s3_verify_ssl: bool = True

    run_migrations_on_boot: bool = True
    # Set to False in tests to skip the S3 bucket bootstrap (tests use moto
    # in-process; they don't need the lifespan's ensure_bucket() side-effect).
    s3_bootstrap_on_boot: bool = True
    # After generating a section, deterministically detect voice-rule violations
    # (em/en dashes, ASCII `--`, banished words) and repair them via the model +
    # a deterministic backstop. Default on — it's the tool's whole premise.
    enforce_voice_rules: bool = True

    # Auth cookie flags. Default False so the test suite (which talks to
    # http://testserver) can replay the session cookie. Production deploys
    # set BLOGFORGE_COOKIE_SECURE=true.
    cookie_secure: bool = False
    cookie_samesite: str = "lax"  # production cross-site flows can override to "none"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_csv(cls, v: object) -> object:
        """Accept comma-separated string from env: BLOGFORGE_CORS_ORIGINS=a,b,c."""
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @field_validator("github_allowlist", mode="before")
    @classmethod
    def split_allowlist(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip().lower() for s in v.split(",") if s.strip()]
        return v

    @field_validator("tanzu_models", mode="before")
    @classmethod
    def _split_tanzu_models(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @model_validator(mode="after")
    def _derive_paths(self) -> "Settings":
        """Fill storage_dir / database_url from data_dir when not set explicitly,
        and expand ~ so downstream (aiosqlite, FsStorage) sees real paths."""
        base = os.path.expanduser(self.data_dir)
        if not self.storage_dir:
            self.storage_dir = os.path.join(base, "blobs")
        if not self.database_url:
            self.database_url = f"sqlite+aiosqlite:///{os.path.join(base, 'blogforge.db')}"
        elif self.database_url.startswith("sqlite"):
            self.database_url = _expand_sqlite_url(self.database_url)
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide singleton. Cache so we don't re-parse env on every call."""
    return Settings()
