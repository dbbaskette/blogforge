"""References — extractors for URL / file / pasted-text reference materials.

The extractors produce a clean markdown body the LLM consumes; the
original bytes are kept alongside in S3 for audit/re-extraction.
"""
from pencraft.references.extractors import (
    EXTRACTED_CHAR_CAP,
    ExtractionResult,
    UnsupportedFileType,
    extract_file,
    extract_text,
    extract_url,
    file_extension_for_kind,
)

__all__ = [
    "EXTRACTED_CHAR_CAP",
    "ExtractionResult",
    "UnsupportedFileType",
    "extract_file",
    "extract_text",
    "extract_url",
    "file_extension_for_kind",
]
