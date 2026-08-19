"""Structured metadata stored in the existing section last_error column."""

import json

from blogforge.drafts.section_errors import encode_section_error


def test_encode_section_error_preserves_recovery_metadata() -> None:
    encoded = encode_section_error(
        "provider_missing_key",
        "No API key configured.",
        "Add the key in Settings.",
        status=502,
    )

    assert json.loads(encoded) == {
        "version": 1,
        "code": "provider_missing_key",
        "message": "No API key configured.",
        "hint": "Add the key in Settings.",
        "status": 502,
    }


def test_encode_section_error_omits_absent_optional_fields() -> None:
    assert json.loads(encode_section_error("generation_interrupted", "Try again.")) == {
        "version": 1,
        "code": "generation_interrupted",
        "message": "Try again.",
    }
