"""S3 key layout for library references.

    library/{user_id}/{lib_id}/extracted.md   ← cleaned markdown the LLM sees
    library/{user_id}/{lib_id}/original{ext}   ← raw upload / URL stub
"""
from __future__ import annotations

from uuid import UUID


def lib_prefix(user_id: UUID, lib_id: str) -> str:
    return f"library/{user_id}/{lib_id}/"


def lib_extracted_key(user_id: UUID, lib_id: str) -> str:
    return f"library/{user_id}/{lib_id}/extracted.md"


def lib_original_key(user_id: UUID, lib_id: str, ext: str) -> str:
    return f"library/{user_id}/{lib_id}/original{ext}"
