"""Shared type definitions for text-generation providers."""

from typing import Literal

TextProvider = Literal[
    "anthropic",
    "openai",
    "google",
    "claude-cli",
    "codex-cli",
    "tanzu",
]
