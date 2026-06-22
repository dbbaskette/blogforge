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
        # Prefer endpoint_url (carries the https:// scheme the S3 client needs);
        # `endpoint` is scheme-less and makes the client hang on connect.
        endpoint = creds.get("endpoint_url") or creds.get("endpoint")
        access = creds.get("access_key") or creds.get("accessKey")
        secret = creds.get("secret_key") or creds.get("secretKey")
        bucket = creds.get("bucket")
        region = creds.get("region")
        if endpoint:
            _set_if_unset("BLOGFORGE_S3_ENDPOINT_URL", endpoint)
        if access:
            _set_if_unset("BLOGFORGE_S3_ACCESS_KEY", access)
        if secret:
            _set_if_unset("BLOGFORGE_S3_SECRET_KEY", secret)
        if bucket:
            _set_if_unset("BLOGFORGE_S3_BUCKET", bucket)
        if region:
            _set_if_unset("BLOGFORGE_S3_REGION", region)
        # The foundation's SeaweedFS S3 gateway serves a self-signed cert from an
        # internal CA that isn't in the container trust store, and the binding
        # ships no CA bundle — so botocore's default verification fails on every
        # request. Disable it for the bound instance (traffic stays on the
        # foundation's private network). Overridable: `cf set-env … true`.
        _set_if_unset("BLOGFORGE_S3_VERIFY_SSL", "false")
        return


def _apply_genai(instances: list[tuple[str, dict[str, Any]]]) -> None:
    for label, inst in instances:
        if label not in ("genai", "tanzu-genai", "ai-models") and inst.get("name") != "blogforge-ai":
            continue
        creds = inst.get("credentials", {}) or {}
        # The Tanzu GenAI tile nests the real values under "endpoint"
        # ({"endpoint": {"openai_api_base", "api_base", "api_key", ...}}); tolerate
        # a flat shape too. Prefer the OpenAI-compatible base for our provider.
        ep = creds.get("endpoint") if isinstance(creds.get("endpoint"), dict) else creds
        base = ep.get("openai_api_base") or ep.get("api_base") or ep.get("url") or ep.get("uri")
        key = ep.get("api_key") or ep.get("apiKey") or ep.get("key")
        if base:
            _set_if_unset("BLOGFORGE_TANZU_API_BASE", base)
        if key:
            _set_if_unset("BLOGFORGE_TANZU_API_KEY", key)
        # Same self-signed-cert story as SeaweedFS: the GenAI proxy serves a
        # foundation-internal cert the container doesn't trust, so every LLM
        # call would fail TLS verification. Disable it for the bound gateway
        # (overridable via `cf set-env BLOGFORGE_TANZU_VERIFY_SSL true`).
        _set_if_unset("BLOGFORGE_TANZU_VERIFY_SSL", "false")
        return


def _set_if_unset(key: str, value: str) -> None:
    if key in os.environ:
        return
    os.environ[key] = value
