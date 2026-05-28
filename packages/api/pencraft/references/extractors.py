"""Reference content extractors.

Each kind (URL, file, pasted text) returns a uniform ``ExtractionResult``
containing the human-friendly name, the cleaned markdown body that will
be persisted to S3 and shown to the LLM, and the character count.

Sizes are bounded by ``EXTRACTED_CHAR_CAP`` (200k). Anything longer is
truncated with a trailing ``[truncated]`` marker so the LLM can tell it
didn't see the full document.
"""
from __future__ import annotations

import asyncio
import io
import warnings
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import PurePosixPath

import trafilatura

# 200k chars per spec §"Extraction".
EXTRACTED_CHAR_CAP = 200_000
TRUNCATION_MARKER = "\n\n[truncated]"

# Per-URL fetch timeout (seconds). Spec §"Endpoints" requires the URL POST
# to bound network IO so a slow site can't pin a worker.
URL_FETCH_TIMEOUT_SECONDS = 8.0

# Filenames we accept for the file-upload kind.
_SUPPORTED_FILE_EXTENSIONS = {".md", ".txt", ".pdf"}


class UnsupportedFileType(Exception):
    """Raised when a file upload's extension isn't in the allow-list."""

    def __init__(self, ext: str) -> None:
        super().__init__(f"unsupported file extension: {ext!r}")
        self.ext = ext


@dataclass(frozen=True)
class ExtractionResult:
    """Output of every extractor.

    Attributes:
        name: Human-friendly label shown in the UI (page title, filename,
            or user-supplied paste label).
        extracted: Cleaned markdown body. Up to ``EXTRACTED_CHAR_CAP``
            chars + an optional trailing truncation marker.
        extracted_chars: ``len(extracted)``. Stored verbatim on the
            ``references`` row.
    """

    name: str
    extracted: str
    extracted_chars: int


def _truncate(body: str) -> str:
    """Cap a body at EXTRACTED_CHAR_CAP, adding a marker if we cut it."""
    if len(body) <= EXTRACTED_CHAR_CAP:
        return body
    return body[:EXTRACTED_CHAR_CAP] + TRUNCATION_MARKER


def _result(name: str, body: str) -> ExtractionResult:
    bounded = _truncate(body)
    return ExtractionResult(
        name=name,
        extracted=bounded,
        extracted_chars=len(bounded),
    )


# ---------- URL ----------


class _TitleExtractor(HTMLParser):
    """Pull the first <title>…</title> out of an HTML document."""

    def __init__(self) -> None:
        super().__init__()
        self._in_title = False
        self.title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)


def _parse_title(html: str) -> str | None:
    parser = _TitleExtractor()
    try:
        parser.feed(html)
    except Exception:
        return None
    title = "".join(parser.title_parts).strip()
    return title or None


async def extract_url(url: str) -> ExtractionResult:
    """Download a URL via trafilatura and return cleaned markdown.

    Runs trafilatura's blocking calls in a worker thread so the route
    handler stays cooperative. An 8s timeout wraps the fetch+extract;
    anything else (timeout, empty body, parse failure) surfaces as
    ``ValueError`` for the route to map to a 422 ``url_fetch_failed``.
    """

    def _fetch_and_extract() -> tuple[str | None, str | None]:
        html = trafilatura.fetch_url(url)
        if not html:
            return None, None
        extracted = trafilatura.extract(html, output_format="markdown") or ""
        return html, extracted

    try:
        html, extracted = await asyncio.wait_for(
            asyncio.to_thread(_fetch_and_extract),
            timeout=URL_FETCH_TIMEOUT_SECONDS,
        )
    except TimeoutError as err:
        raise ValueError(f"timed out fetching {url}") from err

    if html is None:
        raise ValueError(f"failed to fetch {url}")

    title = _parse_title(html) or url
    return _result(title, extracted or "")


# ---------- file ----------


def file_extension_for_kind(kind: str, filename: str | None = None) -> str:
    """Pick the on-disk extension we use when persisting the original.

    For ``url`` kind the original is a one-line stub carrying the URL —
    we store it as ``.url-stub.txt`` so it remains diff-able. For files
    we preserve the upload's extension (already validated).
    """
    if kind == "url":
        return ".url-stub.txt"
    if kind == "text":
        return ".txt"
    if kind == "file":
        if not filename:
            raise ValueError("file kind requires a filename")
        ext = PurePosixPath(filename).suffix.lower()
        if ext not in _SUPPORTED_FILE_EXTENSIONS:
            raise UnsupportedFileType(ext)
        return ext
    raise ValueError(f"unknown reference kind: {kind!r}")


def _extract_pdf(raw: bytes) -> str:
    """Concatenate pypdf text-extraction across all pages."""
    # pypdf emits informational warnings for some PDFs; suppress in test output.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        parts: list[str] = []
        for page in reader.pages:
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            if text.strip():
                parts.append(text.strip())
        return "\n\n".join(parts)


def extract_file(filename: str, raw: bytes) -> ExtractionResult:
    """Dispatch on extension. Reject anything outside the allow-list."""
    ext = PurePosixPath(filename).suffix.lower()
    if ext not in _SUPPORTED_FILE_EXTENSIONS:
        raise UnsupportedFileType(ext)

    if ext in {".md", ".txt"}:
        try:
            body = raw.decode("utf-8")
        except UnicodeDecodeError:
            body = raw.decode("utf-8", errors="replace")
        return _result(filename, body)

    if ext == ".pdf":
        body = _extract_pdf(raw)
        return _result(filename, body)

    raise UnsupportedFileType(ext)  # pragma: no cover — guarded above


# ---------- pasted text ----------


def extract_text(name: str, content: str) -> ExtractionResult:
    """Identity extractor for user-pasted text references."""
    return _result(name, content)


# Re-export the allow-list so the route handler can render the right 415 message.
SUPPORTED_FILE_EXTENSIONS = frozenset(_SUPPORTED_FILE_EXTENSIONS)
