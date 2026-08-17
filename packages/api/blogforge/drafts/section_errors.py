"""Stable serialization for recoverable section failures.

Section failures live in the existing text ``last_error`` column. Keeping a
small versioned envelope there preserves recovery metadata across reloads
without requiring a schema migration.
"""

from __future__ import annotations

import json


def encode_section_error(
    code: str,
    message: str,
    hint: str | None = None,
    *,
    status: int | None = None,
) -> str:
    payload: dict[str, int | str] = {
        "version": 1,
        "code": code,
        "message": message,
    }
    if hint:
        payload["hint"] = hint
    if status is not None:
        payload["status"] = status
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
