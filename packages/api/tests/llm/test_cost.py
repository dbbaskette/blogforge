"""Cost calculator tests."""
from __future__ import annotations

import pytest

from pencraft.llm.cost import usd


def test_anthropic_sonnet_cost() -> None:
    # 1M input @ $3, 1M output @ $15 = $18 total
    assert usd("anthropic", "claude-sonnet-4-6", 1_000_000, 1_000_000) == pytest.approx(18.0)


def test_partial_token_cost() -> None:
    # 1k input @ $3/M = $0.003; 500 output @ $15/M = $0.0075
    assert usd("anthropic", "claude-sonnet-4-6", 1_000, 500) == pytest.approx(0.0105)


def test_unknown_model_returns_zero() -> None:
    assert usd("anthropic", "does-not-exist", 1000, 1000) == 0.0


def test_unknown_provider_returns_zero() -> None:
    assert usd("nope", "model", 1000, 1000) == 0.0
