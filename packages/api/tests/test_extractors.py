"""Reference extractors: URL via trafilatura, file (md/txt/pdf), pasted text."""
from __future__ import annotations

import io
from unittest import mock

import pytest

from blogforge.references.extractors import (
    EXTRACTED_CHAR_CAP,
    ExtractionResult,
    UnsupportedFileType,
    extract_file,
    extract_text,
    extract_url,
)

# ---------- URL ----------

def _fake_fetch_url(html: str):
    return mock.Mock(return_value=html)


async def test_extract_url_returns_clean_markdown() -> None:
    html = (
        "<html><head><title>Stripe Atlas Docs</title></head>"
        "<body><article><h1>Heading</h1><p>Body text.</p></article></body></html>"
    )
    with (
        mock.patch("blogforge.references.extractors.trafilatura.fetch_url", return_value=html),
        mock.patch(
            "blogforge.references.extractors.trafilatura.extract",
            return_value="Heading\n\nBody text.",
        ),
    ):
        result = await extract_url("https://example.com/docs")
    assert isinstance(result, ExtractionResult)
    assert "Body text" in result.extracted
    assert result.extracted_chars == len(result.extracted)
    # Name should reflect either the page title or be a sensible default.
    assert result.name


async def test_extract_url_falls_back_to_url_when_title_unavailable() -> None:
    html = "<html><body><p>Just a paragraph.</p></body></html>"
    with (
        mock.patch("blogforge.references.extractors.trafilatura.fetch_url", return_value=html),
        mock.patch(
            "blogforge.references.extractors.trafilatura.extract",
            return_value="Just a paragraph.",
        ),
    ):
        result = await extract_url("https://example.com/page")
    # When the HTML has no <title>, we fall back to the URL itself.
    assert result.name == "https://example.com/page"


async def test_extract_url_fetch_failure_raises() -> None:
    with mock.patch(
        "blogforge.references.extractors.trafilatura.fetch_url", return_value=None
    ):
        with pytest.raises(ValueError):
            await extract_url("https://example.com/nope")


async def test_extract_url_truncates_at_cap() -> None:
    html = "<html><head><title>big</title></head><body><p>x</p></body></html>"
    big = "a" * (EXTRACTED_CHAR_CAP + 5_000)
    with (
        mock.patch("blogforge.references.extractors.trafilatura.fetch_url", return_value=html),
        mock.patch("blogforge.references.extractors.trafilatura.extract", return_value=big),
    ):
        result = await extract_url("https://example.com/big")
    assert result.extracted.endswith("[truncated]")
    assert result.extracted_chars <= EXTRACTED_CHAR_CAP + len("\n\n[truncated]")


# ---------- file (.md / .txt) ----------

def test_extract_file_md_identity() -> None:
    raw = b"# Heading\n\nSome **markdown** body."
    result = extract_file("notes.md", raw)
    assert result.name == "notes.md"
    assert "Some **markdown** body." in result.extracted


def test_extract_file_txt_identity() -> None:
    raw = b"plain text content"
    result = extract_file("notes.txt", raw)
    assert result.extracted == "plain text content"


def test_extract_file_unsupported_raises() -> None:
    with pytest.raises(UnsupportedFileType):
        extract_file("image.png", b"\x89PNG")


def test_extract_file_truncates_at_cap() -> None:
    big = ("x" * (EXTRACTED_CHAR_CAP + 100)).encode()
    result = extract_file("big.txt", big)
    assert result.extracted.endswith("[truncated]")
    assert result.extracted_chars <= EXTRACTED_CHAR_CAP + len("\n\n[truncated]")


# ---------- file (.pdf) ----------

def _tiny_pdf_bytes() -> bytes:
    """Synthesize a minimal one-page PDF carrying some text via pypdf."""
    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_extract_file_pdf_handles_blank_page() -> None:
    raw = _tiny_pdf_bytes()
    result = extract_file("blank.pdf", raw)
    # A blank page extracts to empty (or near-empty) — but the call must not crash.
    assert isinstance(result, ExtractionResult)
    assert result.name == "blank.pdf"


# ---------- pasted text ----------

def test_extract_text_identity() -> None:
    result = extract_text("Field notes", "These are my notes.")
    assert result.name == "Field notes"
    assert result.extracted == "These are my notes."
    assert result.extracted_chars == len("These are my notes.")


def test_extract_text_truncates_at_cap() -> None:
    big = "z" * (EXTRACTED_CHAR_CAP + 50)
    result = extract_text("Big paste", big)
    assert result.extracted.endswith("[truncated]")
    assert result.extracted_chars <= EXTRACTED_CHAR_CAP + len("\n\n[truncated]")
