"""apply_vcap_services translates a bound services payload into env vars."""
import json
import os
from unittest import mock

from blogforge.config.tanzu import apply_vcap_services

VCAP = {
    "postgresql": [
        {
            "name": "blogforge-postgres",
            "credentials": {"uri": "postgres://u:p@h:5432/db"},
        }
    ],
    "seaweedfs": [
        {
            "name": "blogforge-s3",
            "credentials": {
                "endpoint": "https://seaweed.example.com",
                "access_key": "AK",
                "secret_key": "SK",
            },
        }
    ],
}


def test_translates_postgres_uri_to_asyncpg():
    with mock.patch.dict(os.environ, {"VCAP_SERVICES": json.dumps(VCAP)}, clear=True):
        apply_vcap_services()
        assert os.environ["BLOGFORGE_DATABASE_URL"] == (
            "postgresql+asyncpg://u:p@h:5432/db"
        )


def test_translates_s3_credentials():
    with mock.patch.dict(os.environ, {"VCAP_SERVICES": json.dumps(VCAP)}, clear=True):
        apply_vcap_services()
        assert os.environ["BLOGFORGE_S3_ENDPOINT_URL"] == "https://seaweed.example.com"
        assert os.environ["BLOGFORGE_S3_ACCESS_KEY"] == "AK"
        assert os.environ["BLOGFORGE_S3_SECRET_KEY"] == "SK"


def test_silent_when_vcap_absent():
    with mock.patch.dict(os.environ, {}, clear=True):
        apply_vcap_services()  # must not raise


def test_does_not_overwrite_already_set_env():
    """If the operator set BLOGFORGE_DATABASE_URL explicitly, keep it."""
    env = {
        "VCAP_SERVICES": json.dumps(VCAP),
        "BLOGFORGE_DATABASE_URL": "sqlite+aiosqlite:///./override.db",
    }
    with mock.patch.dict(os.environ, env, clear=True):
        apply_vcap_services()
        assert os.environ["BLOGFORGE_DATABASE_URL"] == "sqlite+aiosqlite:///./override.db"
