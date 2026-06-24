"""Application settings, loaded from BLOGFORGE_*-prefixed env vars."""
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
        env_prefix="BLOGFORGE_",
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

    github_client_id: str = ""
    github_client_secret: str = ""
    github_admin_login: str = ""
    # Public base URL for the OAuth callback (e.g. https://blogforge.<tp-domain>).
    # Empty -> derived from the incoming request (works on localhost).
    public_url: str = ""
    github_allowlist: Annotated[list[str], NoDecode] = Field(default_factory=list)

    tanzu_api_base: str = ""
    tanzu_api_key: str = ""
    tanzu_models: Annotated[list[str], NoDecode] = Field(default_factory=lambda: [
        "openai/gpt-oss-120b", "Qwen/Qwen3.5-27B-GPTQ-Int4", "google/gemma-4-31B-it",
    ])
    # Like s3_verify_ssl: the bound GenAI proxy presents a self-signed cert from
    # the foundation's internal CA, so config/tanzu._apply_genai flips this to
    # False for the bound gateway. Default True keeps real OpenAI strict.
    tanzu_verify_ssl: bool = True

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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide singleton. Cache so we don't re-parse env on every call."""
    return Settings()
