"""Filesystem-backed blob storage.

The no-Docker local backend (write blobs to a dir instead of MinIO) and the
Tanzu Block Storage backend (a bound volume mounted into the container is just a
path). Implements the SAME method surface as S3Client — put/get/head/delete/
delete_prefix + bootstrap — so `get_s3_client()` can return either and no caller
changes. Object keys ('a/b/c') map to files under a base dir.
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from blogforge.config import get_settings
from blogforge.s3.client import S3Error


class FsStorage:
    """Blob store over a local/mounted directory. Keys are '/'-joined paths."""

    def __init__(self, base_dir: str | None = None) -> None:
        root = base_dir if base_dir is not None else get_settings().storage_dir
        self._root = Path(root).expanduser().resolve()

    @property
    def bucket(self) -> str:
        return str(self._root)

    def _path(self, key: str) -> Path:
        # Resolve under root and reject path traversal (a key like "../etc").
        p = (self._root / key.lstrip("/")).resolve()
        if p != self._root and self._root not in p.parents:
            raise S3Error(f"unsafe storage key {key!r}")
        return p

    async def bootstrap(self) -> None:
        """Create the base dir if missing — the FS equivalent of the S3 bucket."""
        await asyncio.to_thread(self._root.mkdir, parents=True, exist_ok=True)

    async def put_object(
        self, key: str, body: bytes, content_type: str = "application/octet-stream"
    ) -> None:
        p = self._path(key)

        def _write() -> None:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_name(f"{p.name}.tmp")
            tmp.write_bytes(body)
            tmp.replace(p)  # atomic within the same dir

        try:
            await asyncio.to_thread(_write)
        except OSError as err:
            raise S3Error(f"put_object({key!r}) failed: {err}") from err

    async def get_object(self, key: str) -> bytes:
        p = self._path(key)
        try:
            return await asyncio.to_thread(p.read_bytes)
        except FileNotFoundError as err:
            raise S3Error(f"get_object({key!r}) failed: not found") from err
        except OSError as err:
            raise S3Error(f"get_object({key!r}) failed: {err}") from err

    async def head_object(self, key: str) -> bool:
        return await asyncio.to_thread(self._path(key).is_file)

    async def delete_object(self, key: str) -> None:
        p = self._path(key)
        try:
            await asyncio.to_thread(p.unlink, True)  # missing_ok=True
        except OSError as err:
            raise S3Error(f"delete_object({key!r}) failed: {err}") from err

    async def delete_prefix(self, prefix: str) -> int:
        """Delete every object whose key starts with `prefix`. Returns the count.

        A prefix usually names a directory (e.g. "voice/<id>/"); we also handle a
        partial leaf ("voice/<id>/orig") by matching sibling files.
        """
        base = self._path(prefix)

        def _delete() -> int:
            if base.is_dir():
                n = sum(1 for f in base.rglob("*") if f.is_file())
                shutil.rmtree(base, ignore_errors=True)
                return n
            parent, leaf = base.parent, base.name
            deleted = 0
            if parent.is_dir():
                for f in parent.iterdir():
                    if f.is_file() and f.name.startswith(leaf):
                        f.unlink()
                        deleted += 1
            return deleted

        try:
            return await asyncio.to_thread(_delete)
        except OSError as err:
            raise S3Error(f"delete_prefix({prefix!r}) failed: {err}") from err
