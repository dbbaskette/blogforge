"""Typed exceptions for LLM provider failures."""
from __future__ import annotations


class ProviderError(Exception):
    """Generic provider failure. Subclasses carry semantic codes."""
    code: str = "provider_error"

    def __init__(self, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint

    def _with_code(self, code: str) -> ProviderError:
        self.code = code
        return self


class ProviderMissingKey(ProviderError):
    code = "provider_missing_key"

    def __init__(self, provider: str) -> None:
        super().__init__(
            f"No API key configured for provider '{provider}'.",
            hint="Add the key in Settings.",
        )
        self.provider = provider


class ProviderRateLimit(ProviderError):
    code = "provider_rate_limit"

    def __init__(self, message: str, *, retry_after_seconds: int | None = None) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds
