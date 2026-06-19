"""In-memory index of discovered style packs."""

from __future__ import annotations

import os
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

from blogforge.voice.packs.discovery import PackInfo, discover_packs


class PackStore:
    """Holds a dict of slug -> PackInfo, plus a record of slug conflicts."""

    def __init__(self, roots: list[Path]):
        self._roots = roots
        self._by_slug: dict[str, PackInfo] = {}
        self._conflicts: dict[str, list[Path]] = {}
        self.reload()

    def reload(self) -> None:
        """Re-scan all configured roots."""
        self._by_slug = {}
        seen: dict[str, list[Path]] = defaultdict(list)
        for info in discover_packs(self._roots):
            seen[info.slug].append(info.root_path)
            if info.slug not in self._by_slug:
                self._by_slug[info.slug] = info
        self._conflicts = {slug: paths for slug, paths in seen.items() if len(paths) > 1}

    def rescan(self, new_roots: list[str] | list[Path]) -> None:
        """Update pack roots and re-walk discovery. Accepts str or Path entries."""
        self._roots = [Path(r) for r in new_roots]
        self.reload()

    def rescan_one(self, slug: str) -> None:
        """Re-read and re-validate a single pack by slug.

        If the pack's directory no longer contains a stylepack.yaml, remove the
        entry from the store (mirrors deletion). If the pack is still present,
        replace the entry with a freshly-validated PackInfo.
        """
        from blogforge.voice.packs.discovery import discover_packs

        info = self._by_slug.get(slug)
        if info is None:
            # Try to find it across roots (maybe it was added).
            self.reload()
            return

        pack_dir = info.root_path
        manifest_path = pack_dir / "stylepack.yaml"
        if not manifest_path.is_file():
            # Pack was deleted.
            self._by_slug.pop(slug, None)
            return

        # Re-validate and replace the entry.
        new_infos = discover_packs([pack_dir.parent])
        for new_info in new_infos:
            if new_info.slug == slug or new_info.root_path == pack_dir:
                self._by_slug[new_info.slug] = new_info
                # If slug changed (rare), remove old key.
                if new_info.slug != slug:
                    self._by_slug.pop(slug, None)
                return

        # discover_packs found nothing — pack directory no longer a valid pack.
        self._by_slug.pop(slug, None)

    def save_manifest(self, slug: str, data: dict[str, Any]) -> None:
        """Atomically write ``data`` as YAML to the pack's stylepack.yaml.

        After writing, the in-memory entry is refreshed via ``rescan_one``.
        Raises ``KeyError`` if the slug is unknown.
        """
        info = self._by_slug.get(slug)
        if info is None:
            raise KeyError(f"Unknown pack slug: {slug!r}")

        manifest_path = info.root_path / "stylepack.yaml"
        text = yaml.safe_dump(data, sort_keys=False)
        tmp = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(manifest_path.parent),
            prefix=".stylepack.",
            suffix=".tmp",
            delete=False,
        )
        try:
            tmp.write(text)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp.close()
            os.replace(tmp.name, str(manifest_path))
        except Exception:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
            raise

        self.rescan_one(slug)

    def slugs(self) -> list[str]:
        return sorted(self._by_slug.keys())

    def get(self, slug: str) -> PackInfo | None:
        return self._by_slug.get(slug)

    def conflicts(self) -> dict[str, list[Path]]:
        return dict(self._conflicts)
