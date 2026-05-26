"""Filesystem-backed CRUD for drafts."""
from __future__ import annotations

import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from pencraft.drafts.models import Draft, DraftSummary, IdeaInput


class DraftStore:
    """Per-draft directory at <root>/<id>/.

    Each draft dir holds:
      draft.json   atomic-written
      post.md      always-current assembled markdown
    Trash at <root>/../trash/<ts>-<id>/ on delete.
    """

    def __init__(self, root: Path) -> None:
        self._root = root
        root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    def list(self) -> list[DraftSummary]:
        summaries: list[DraftSummary] = []
        for entry in self._root.iterdir():
            if not entry.is_dir():
                continue
            draft_json = entry / "draft.json"
            if not draft_json.is_file():
                continue
            try:
                draft = Draft.model_validate_json(draft_json.read_text(encoding="utf-8"))
            except Exception:
                continue
            summaries.append(_summary_of(draft))
        summaries.sort(key=lambda s: s.updated_at, reverse=True)
        return summaries

    def get(self, draft_id: str) -> Draft | None:
        path = self._root / draft_id / "draft.json"
        if not path.is_file():
            return None
        return Draft.model_validate_json(path.read_text(encoding="utf-8"))

    def create(self, idea: IdeaInput) -> Draft:
        draft = Draft(idea=idea, title=idea.topic)
        self._write(draft)
        return draft

    def update(self, draft_id: str, draft: Draft) -> Draft:
        if draft.id != draft_id:
            raise ValueError(f"draft.id {draft.id!r} != path id {draft_id!r}")
        draft.updated_at = datetime.now(UTC)
        self._write(draft)
        return draft

    def delete(self, draft_id: str) -> None:
        src = self._root / draft_id
        if not src.exists():
            raise KeyError(draft_id)
        trash_root = self._root.parent / "trash"
        trash_root.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        target = trash_root / f"{ts}-{draft_id}"
        shutil.move(str(src), str(target))

    def assemble_markdown(self, draft: Draft) -> str:
        parts: list[str] = []
        if draft.title:
            parts.append(f"# {draft.title}\n")
        if draft.outline and draft.outline.opening_hook:
            parts.append(draft.outline.opening_hook.strip() + "\n")
        for section in draft.sections:
            parts.append(f"## {section.title}\n")
            if section.content_md.strip():
                parts.append(section.content_md.strip() + "\n")
        return "\n".join(parts) + "\n"

    def _write(self, draft: Draft) -> None:
        draft_dir = self._root / draft.id
        draft_dir.mkdir(parents=True, exist_ok=True)
        # Atomic write draft.json
        _atomic_write_text(draft_dir / "draft.json", draft.model_dump_json(indent=2))
        # Always-current post.md
        _atomic_write_text(draft_dir / "post.md", self.assemble_markdown(draft))


def _summary_of(draft: Draft) -> DraftSummary:
    word_count = sum(s.word_count for s in draft.sections)
    return DraftSummary(
        id=draft.id,
        title=draft.title or draft.idea.topic,
        stage=draft.stage,
        pack_slug=draft.idea.pack_slug,
        updated_at=draft.updated_at,
        word_count=word_count,
    )


def _atomic_write_text(path: Path, text: str) -> None:
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, str(path))
    except Exception:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
        raise
