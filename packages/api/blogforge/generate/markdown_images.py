"""Remove embedded image payloads from imported Markdown."""

from __future__ import annotations

import re
from dataclasses import dataclass


_FALLBACK_ALT = "embedded image"
_REFERENCE_DEFINITION_RE = re.compile(
    r"^ {0,3}\[([^\]]+)\]:[ \t]*<?data:image/[^\s>]+>?(?:[ \t]+.*)?(?:\r?\n|$)",
    re.IGNORECASE | re.MULTILINE,
)
_REFERENCE_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\[([^\]]*)\]")
_INLINE_IMAGE_RE = re.compile(
    r"!\[([^\]]*)\]\(\s*<?data:image/[^)\s>]+>?(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)",
    re.IGNORECASE,
)
_HTML_IMAGE_RE = re.compile(
    r"<img\b(?=[^>]*\bsrc\s*=\s*(['\"])data:image/)[^>]*>", re.IGNORECASE
)
_ALT_ATTRIBUTE_RE = re.compile(r"\balt\s*=\s*(['\"])(.*?)\1", re.IGNORECASE)


@dataclass(frozen=True)
class EmbeddedImageCleanup:
    text: str
    removed_images: int
    removed_characters: int


def _placeholder(alt: str) -> str:
    return f"[Image omitted during import: {alt.strip() or _FALLBACK_ALT}]"


def _normalize_reference_label(label: str) -> str:
    return " ".join(label.split()).lower()


def strip_embedded_images(markdown: str) -> EmbeddedImageCleanup:
    """Replace Markdown and HTML ``data:image`` payloads with readable text."""

    removed_images = 0
    removed_characters = 0
    embedded_reference_labels: set[str] = set()

    def remove_reference_definition(match: re.Match[str]) -> str:
        nonlocal removed_images, removed_characters
        embedded_reference_labels.add(_normalize_reference_label(match.group(1)))
        removed_images += 1
        removed_characters += len(match.group(0).removesuffix("\n").removesuffix("\r"))
        return ""

    text = _REFERENCE_DEFINITION_RE.sub(remove_reference_definition, markdown)

    def replace_reference_image(match: re.Match[str]) -> str:
        alt, label = match.groups()
        return _placeholder(alt) if _normalize_reference_label(label or alt) in embedded_reference_labels else match.group(0)

    text = _REFERENCE_IMAGE_RE.sub(replace_reference_image, text)

    def replace_inline_image(match: re.Match[str]) -> str:
        nonlocal removed_images, removed_characters
        removed_images += 1
        removed_characters += len(match.group(0))
        return _placeholder(match.group(1))

    text = _INLINE_IMAGE_RE.sub(replace_inline_image, text)

    def replace_html_image(match: re.Match[str]) -> str:
        nonlocal removed_images, removed_characters
        image = match.group(0)
        alt_match = _ALT_ATTRIBUTE_RE.search(image)
        removed_images += 1
        removed_characters += len(image)
        return _placeholder(alt_match.group(2) if alt_match else "")

    text = _HTML_IMAGE_RE.sub(replace_html_image, text)

    return EmbeddedImageCleanup(
        text=text,
        removed_images=removed_images,
        removed_characters=removed_characters,
    )
