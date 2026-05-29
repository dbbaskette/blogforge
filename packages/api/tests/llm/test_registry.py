import pytest

from blogforge.llm.exceptions import ProviderError, ProviderMissingKey
from blogforge.llm.registry import get_provider


def test_unknown_provider_raises() -> None:
    with pytest.raises(ProviderError):
        get_provider("nope", "key")


def test_missing_key_raises() -> None:
    with pytest.raises(ProviderMissingKey):
        get_provider("anthropic", "")
