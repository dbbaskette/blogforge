"""FsStorage — the filesystem blob backend for no-Docker local dev and Tanzu
Block Storage. Same surface as S3Client; exercised here against a tmp dir."""

from __future__ import annotations

from pathlib import Path

import pytest

from blogforge.s3.client import S3Error
from blogforge.s3.fs import FsStorage


def _store(tmp_path: Path) -> FsStorage:
    return FsStorage(base_dir=str(tmp_path))


async def test_put_get_head_delete_round_trip(tmp_path: Path) -> None:
    s = _store(tmp_path)
    await s.bootstrap()
    assert await s.head_object("voice/a/orig.md") is False
    await s.put_object("voice/a/orig.md", b"# hi", "text/markdown")
    assert await s.head_object("voice/a/orig.md") is True
    assert await s.get_object("voice/a/orig.md") == b"# hi"
    await s.delete_object("voice/a/orig.md")
    assert await s.head_object("voice/a/orig.md") is False


async def test_get_missing_raises_s3error(tmp_path: Path) -> None:
    with pytest.raises(S3Error):
        await _store(tmp_path).get_object("nope/missing.bin")


async def test_delete_prefix_removes_the_subtree(tmp_path: Path) -> None:
    s = _store(tmp_path)
    await s.put_object("voice/x/a.md", b"a")
    await s.put_object("voice/x/b.md", b"b")
    await s.put_object("voice/y/c.md", b"c")
    assert await s.delete_prefix("voice/x/") == 2
    assert await s.head_object("voice/x/a.md") is False
    assert await s.head_object("voice/y/c.md") is True


async def test_key_traversal_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(S3Error):
        await _store(tmp_path).put_object("../escape.txt", b"x")


async def test_get_s3_client_returns_fs_backend_when_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The selector honours storage_backend=fs (production default)."""
    from blogforge.config import get_settings
    from blogforge.s3.client import get_s3_client, reset_s3_client_for_tests

    monkeypatch.setenv("BLOGFORGE_STORAGE_BACKEND", "fs")
    monkeypatch.setenv("BLOGFORGE_STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    reset_s3_client_for_tests()
    try:
        assert isinstance(get_s3_client(), FsStorage)
    finally:
        reset_s3_client_for_tests()
        get_settings.cache_clear()
