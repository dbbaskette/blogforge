"""Settings load defaults; env overrides take precedence."""
import os
from unittest import mock

from pencraft.config.settings import Settings


def test_defaults_when_no_env():
    """Settings have sane defaults so the test suite never needs env vars."""
    with mock.patch.dict(os.environ, {}, clear=True):
        s = Settings()
    assert s.database_url.startswith("sqlite+aiosqlite://")
    assert s.admin_email == "dbbaskette@gmail.com"
    assert s.admin_password == "VMware0!"
    assert s.session_secret  # non-empty default
    assert s.cors_origins == ["http://localhost:7881"]
    assert s.s3_bucket == "pencraft"


def test_env_overrides():
    """PENCRAFT_-prefixed env vars override defaults."""
    env = {
        "PENCRAFT_DATABASE_URL": "postgresql+asyncpg://u:p@h/db",
        "PENCRAFT_ADMIN_EMAIL": "root@example.com",
        "PENCRAFT_CORS_ORIGINS": "http://a.com,http://b.com",
    }
    with mock.patch.dict(os.environ, env, clear=True):
        s = Settings()
    assert s.database_url == "postgresql+asyncpg://u:p@h/db"
    assert s.admin_email == "root@example.com"
    assert s.cors_origins == ["http://a.com", "http://b.com"]
