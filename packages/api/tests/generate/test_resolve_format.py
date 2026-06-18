"""resolve_format — ignore a draft format the active voice doesn't define."""
from blogforge.generate.formats import resolve_format


def test_returns_format_when_manifest_defines_it(tmp_path) -> None:
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "stylepack.yaml").write_text(
        "formats:\n  - name: blog-post\n    file: formats/blog-post.md\n", encoding="utf-8"
    )
    assert resolve_format(pack, "blog-post") == "blog-post"


def test_returns_none_for_unknown_format(tmp_path) -> None:
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "stylepack.yaml").write_text(
        "formats:\n  - name: blog-post\n    file: x.md\n", encoding="utf-8"
    )
    assert resolve_format(pack, "linkedin-post") is None


def test_profile_pack_with_empty_formats_drops_the_format(tmp_path) -> None:
    # This is the voice-profile case that produced the HTTP 422.
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "stylepack.yaml").write_text("formats: []\n", encoding="utf-8")
    assert resolve_format(pack, "blog-post") is None


def test_none_and_missing_manifest(tmp_path) -> None:
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "stylepack.yaml").write_text("formats: []\n", encoding="utf-8")
    assert resolve_format(pack, None) is None
    assert resolve_format(tmp_path / "does-not-exist", "blog-post") is None
