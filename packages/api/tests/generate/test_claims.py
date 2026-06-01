"""Fact-check: extract claims and judge them against references."""
from __future__ import annotations

import json

import pytest

from blogforge.generate.claims import _build_prompt, check_claims


def test_prompt_uses_references_when_present() -> None:
    p = _build_prompt("The sky is green.", "## Reference Materials\nThe sky is blue.")
    assert "The sky is blue." in p  # reference context embedded
    assert "Judge each claim" in p
    assert "The sky is green." in p  # article embedded


def test_prompt_handles_no_references() -> None:
    p = _build_prompt("Coffee was invented in 1850.", "")
    assert "No reference materials are attached" in p
    assert "needs a citation" in p


@pytest.mark.asyncio
async def test_check_claims_parses_and_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BLOGFORGE_TEST_PROVIDER", "mock")
    monkeypatch.setenv(
        "BLOGFORGE_MOCK_OUTPUT_JSON",
        json.dumps(
            {
                "claims": [
                    {"text": "X happened in 2020.", "status": "contradicted", "note": "Ref says 2019."},
                    {"text": "Y is fast.", "status": "unsupported", "note": "No source."},
                    {"text": "Z is true.", "status": "bogus", "note": "drop me"},  # invalid status
                    {"status": "supported", "note": "missing text"},  # no text → dropped
                ]
            }
        ),
    )
    from blogforge.llm.registry import get_provider

    provider = get_provider("anthropic", "sk-mock")
    out = await check_claims("article body", "## Reference Materials\nstuff", provider, model="m")
    # Only the two valid claims survive; invalid status / missing text are dropped.
    assert len(out) == 2
    assert out[0]["status"] == "contradicted"
    assert out[1]["status"] == "unsupported"
