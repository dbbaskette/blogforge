"""Translate Cloud Foundry's VCAP_SERVICES into PENCRAFT_* env vars.

Called once at process import (before pydantic-settings reads env). On
local dev where VCAP_SERVICES is absent this is a no-op.

Matches services by service-type label first (postgresql / seaweedfs)
and falls back to instance name. Never overwrites an env var the operator
already set explicitly — so `cf set-env PENCRAFT_DATABASE_URL ...` always
wins over bound-service inference.
"""
import json
import logging
import os

_log = logging.getLogger(__name__)


def apply_vcap_services() -> None:
    """Read VCAP_SERVICES and set PENCRAFT_* env vars for bound services."""
    raw = os.environ.get("VCAP_SERVICES")
    if not raw:
        return
    try:
        vcap = json.loads(raw)
    except json.JSONDecodeError:
        _log.warning("VCAP_SERVICES is not valid JSON; ignoring")
        return

    # Flatten all service bindings into (label, instance) pairs.
    instances: list[tuple[str, dict]] = []
    for label, bindings in vcap.items():
        if not isinstance(bindings, list):
            continue
        for b in bindings:
            if isinstance(b, dict):
                instances.append((label, b))

    _apply_postgres(instances)
    _apply_s3(instances)


def _apply_postgres(instances: list[tuple[str, dict]]) -> None:
    for label, inst in instances:
        if label not in ("postgresql", "postgres") and inst.get("name") != "pencraft-postgres":
            continue
        creds = inst.get("credentials", {})
        uri = creds.get("uri") or creds.get("url")
        if not uri:
            continue
        # Cloud Foundry hands us `postgres://...`. Convert to the asyncpg driver.
        if uri.startswith("postgres://"):
            uri = "postgresql+asyncpg://" + uri[len("postgres://"):]
        elif uri.startswith("postgresql://"):
            uri = "postgresql+asyncpg://" + uri[len("postgresql://"):]
        _set_if_unset("PENCRAFT_DATABASE_URL", uri)
        return


def _apply_s3(instances: list[tuple[str, dict]]) -> None:
    for label, inst in instances:
        if label not in ("seaweedfs", "s3") and inst.get("name") != "pencraft-s3":
            continue
        creds = inst.get("credentials", {})
        endpoint = creds.get("endpoint") or creds.get("endpoint_url")
        access = creds.get("access_key") or creds.get("accessKey")
        secret = creds.get("secret_key") or creds.get("secretKey")
        if endpoint:
            _set_if_unset("PENCRAFT_S3_ENDPOINT_URL", endpoint)
        if access:
            _set_if_unset("PENCRAFT_S3_ACCESS_KEY", access)
        if secret:
            _set_if_unset("PENCRAFT_S3_SECRET_KEY", secret)
        return


def _set_if_unset(key: str, value: str) -> None:
    if key in os.environ:
        return
    os.environ[key] = value
