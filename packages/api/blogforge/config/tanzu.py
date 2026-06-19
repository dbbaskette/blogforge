"""Translate Cloud Foundry's VCAP_SERVICES into BLOGFORGE_* env vars.

Called once at process import (before pydantic-settings reads env). On
local dev where VCAP_SERVICES is absent this is a no-op.

Matches services by service-type label first (postgresql / seaweedfs)
and falls back to instance name. Never overwrites an env var the operator
already set explicitly — so `cf set-env BLOGFORGE_DATABASE_URL ...` always
wins over bound-service inference.
"""
import json
import logging
import os
from typing import Any

_log = logging.getLogger(__name__)


def apply_vcap_services() -> None:
    """Read VCAP_SERVICES and set BLOGFORGE_* env vars for bound services."""
    raw = os.environ.get("VCAP_SERVICES")
    if not raw:
        return
    try:
        vcap = json.loads(raw)
    except json.JSONDecodeError:
        _log.warning("VCAP_SERVICES is not valid JSON; ignoring")
        return

    # Flatten all service bindings into (label, instance) pairs.
    instances: list[tuple[str, dict[str, Any]]] = []
    for label, bindings in vcap.items():
        if not isinstance(bindings, list):
            continue
        for b in bindings:
            if isinstance(b, dict):
                instances.append((label, b))

    _apply_postgres(instances)
    _apply_s3(instances)
    _apply_genai(instances)


def _apply_postgres(instances: list[tuple[str, dict[str, Any]]]) -> None:
    for label, inst in instances:
        if label not in ("postgresql", "postgres") and inst.get("name") != "blogforge-postgres":
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
        _set_if_unset("BLOGFORGE_DATABASE_URL", uri)
        return


def _apply_s3(instances: list[tuple[str, dict[str, Any]]]) -> None:
    for label, inst in instances:
        if label not in ("seaweedfs", "s3") and inst.get("name") != "blogforge-s3":
            continue
        creds = inst.get("credentials", {})
        endpoint = creds.get("endpoint") or creds.get("endpoint_url")
        access = creds.get("access_key") or creds.get("accessKey")
        secret = creds.get("secret_key") or creds.get("secretKey")
        if endpoint:
            _set_if_unset("BLOGFORGE_S3_ENDPOINT_URL", endpoint)
        if access:
            _set_if_unset("BLOGFORGE_S3_ACCESS_KEY", access)
        if secret:
            _set_if_unset("BLOGFORGE_S3_SECRET_KEY", secret)
        return


def _apply_genai(instances: list[tuple[str, dict[str, Any]]]) -> None:
    for label, inst in instances:
        if label not in ("genai", "tanzu-genai") and inst.get("name") != "tanzu-all-models":
            continue
        creds = inst.get("credentials", {}) or {}
        base = creds.get("api_base") or creds.get("endpoint") or creds.get("url") or creds.get("uri")
        key = (creds.get("api_key") or creds.get("apiKey") or creds.get("key")
               or (creds.get("credentials") or {}).get("api_key"))
        if base:
            _set_if_unset("BLOGFORGE_TANZU_API_BASE", base)
        if key:
            _set_if_unset("BLOGFORGE_TANZU_API_KEY", key)
        return


def _set_if_unset(key: str, value: str) -> None:
    if key in os.environ:
        return
    os.environ[key] = value
