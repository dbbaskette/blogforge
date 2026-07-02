"""Regression: section regeneration must validate the parsed stylepack dict into
a Manifest before voice enforcement.

The section job loads ``stylepack.yaml`` as a raw dict and, when
``enforce_voice_rules`` is on, ran it through ``enforce_voice_rules`` — which
requires a ``Manifest``. That blew up with
``'dict' object has no attribute 'banished'`` *after* the model had already
produced the section text, failing the whole regen (matching the other callers
in inline.py / expand.py / voice.py, which all validate first)."""
from __future__ import annotations

import pytest
import yaml

from blogforge.api.section import _enforce_section_voice
from blogforge.voice.enforce import enforce_voice_rules

# Minimal SPEC v1.0 pack — no explicit `banished:` block, so the Manifest falls
# back to an empty Banished (exactly the shape section.py handles at runtime).
_STYLEPACK_YAML = """
spec_version: '1.0'
pack:
  slug: dan
  name: Dan
  version: '1.0'
  author: Dan
persona:
  identity: x
  one_line: y
"""


class _NoCallProvider:
    """Fails loudly if the repair model is invoked — clean text has no
    violations, so enforcement must short-circuit before any provider call."""

    name = "no-call"

    async def complete(self, *, model, prompt, json_schema=None):
        raise AssertionError("provider.complete must not run for clean text")


def _manifest_dict() -> dict:
    return yaml.safe_load(_STYLEPACK_YAML)


async def test_raw_dict_manifest_reproduces_banished_crash() -> None:
    """Documents the root cause: the raw parsed dict cannot go straight into
    enforce_voice_rules — it needs the typed Manifest."""
    with pytest.raises(AttributeError, match="banished"):
        await enforce_voice_rules("A clean sentence.", _manifest_dict(), _NoCallProvider(), "m")


async def test_enforce_section_voice_accepts_parsed_dict() -> None:
    """The section helper validates the dict → Manifest, so a clean section
    passes through unchanged instead of crashing."""
    out = await _enforce_section_voice(
        "A clean sentence.", _manifest_dict(), _NoCallProvider(), "m"
    )
    assert out == "A clean sentence."
