from pathlib import Path

def test_public_api_imports() -> None:
    from blogforge.voice import (  # noqa: F401
        ComposeError, LintHit, Manifest, PackStore, Violation,
        compose_prompt, detect_ai_patterns, detect_positive_hits,
        lint, lint_to_hits, validate_pack,
    )

def test_ai_tells_resource_loads() -> None:
    from blogforge.voice.ai_tells import load_ai_tells
    t = load_ai_tells()
    assert t.words and t.phrases and t.patterns  # bundled resources resolved

def test_compose_prompt_smoke(tmp_path: Path) -> None:
    from blogforge.voice import compose_prompt
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "stylepack.yaml").write_text(
        'spec_version: "1.0"\n'
        "pack:\n"
        "  slug: test\n"
        "  name: Test Pack\n"
        "  version: 0.1.0\n"
        "  author: Tester\n"
        "persona:\n"
        "  identity: A plain writer.\n"
        "  one_line: Writes plainly and directly.\n",
        encoding="utf-8",
    )
    (pack / "style-guide.md").write_text("Write plainly. Avoid jargon.\n", encoding="utf-8")
    out = compose_prompt(pack_root=pack, samples=[], draft="Hello world")
    assert "Write plainly" in out and "Hello world" in out

def test_validate_template_pack() -> None:
    from importlib import resources
    from blogforge.voice import validate_pack
    tmpl = resources.files("blogforge.voice").joinpath("bundled_packs/_template")
    res = validate_pack(Path(str(tmpl)))
    assert res is not None
