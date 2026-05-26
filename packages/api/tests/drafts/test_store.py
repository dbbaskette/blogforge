"""DraftStore: filesystem-backed persistence."""
from __future__ import annotations

from pathlib import Path

from pencraft.drafts import DraftStore, IdeaInput


def _idea() -> IdeaInput:
    return IdeaInput(
        topic="A test topic",
        pack_slug="dan",
        provider="anthropic",
        model="claude-sonnet-4-6",
    )


def test_create_writes_draft_json(tmp_path: Path) -> None:
    store = DraftStore(tmp_path)
    draft = store.create(_idea())
    assert (tmp_path / draft.id / "draft.json").is_file()
    assert (tmp_path / draft.id / "post.md").is_file()


def test_get_returns_draft(tmp_path: Path) -> None:
    store = DraftStore(tmp_path)
    created = store.create(_idea())
    loaded = store.get(created.id)
    assert loaded is not None
    assert loaded.id == created.id
    assert loaded.idea.topic == "A test topic"


def test_get_unknown_returns_none(tmp_path: Path) -> None:
    store = DraftStore(tmp_path)
    assert store.get("does-not-exist") is None


def test_list_returns_summaries(tmp_path: Path) -> None:
    store = DraftStore(tmp_path)
    store.create(_idea())
    store.create(_idea())
    summaries = store.list()
    assert len(summaries) == 2
    assert all(s.pack_slug == "dan" for s in summaries)


def test_update_persists_changes(tmp_path: Path) -> None:
    store = DraftStore(tmp_path)
    draft = store.create(_idea())
    draft.title = "Updated title"
    store.update(draft.id, draft)
    reloaded = store.get(draft.id)
    assert reloaded is not None
    assert reloaded.title == "Updated title"


def test_delete_moves_to_trash(tmp_path: Path) -> None:
    store = DraftStore(tmp_path)
    draft = store.create(_idea())
    store.delete(draft.id)
    assert store.get(draft.id) is None
    assert not (tmp_path / draft.id).exists()
    trash = tmp_path.parent / "trash"
    assert trash.exists()
    entries = list(trash.iterdir())
    assert len(entries) == 1
    assert draft.id in entries[0].name


def test_assemble_markdown_concatenates_sections(tmp_path: Path) -> None:
    from pencraft.drafts.models import OutlineProposal, OutlineSection, Section

    store = DraftStore(tmp_path)
    draft = store.create(_idea())
    draft.title = "My Post"
    draft.outline = OutlineProposal(
        opening_hook="Hook sentence.",
        sections=[OutlineSection(id="s1", title="First"), OutlineSection(id="s2", title="Second")],
    )
    draft.sections = [
        Section(id="s1", title="First", content_md="First section body.", status="ready"),
        Section(id="s2", title="Second", content_md="Second section body.", status="ready"),
    ]
    md = store.assemble_markdown(draft)
    assert "# My Post" in md
    assert "Hook sentence." in md
    assert "## First" in md
    assert "First section body." in md
    assert "## Second" in md
