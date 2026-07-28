from pathlib import Path


def assert_paired(prompt: str, instruction: str, rationale_fragment: str) -> None:
    pair = f"Rule: {instruction}\nBecause: "
    assert pair in prompt
    reason = prompt[prompt.index(pair) + len(pair):].splitlines()[0]
    assert rationale_fragment in reason

def test_public_api_imports() -> None:
    from blogforge.voice import (  # noqa: F401
        ComposeError,
        LintHit,
        Manifest,
        PackStore,
        Violation,
        compose_prompt,
        detect_ai_patterns,
        detect_positive_hits,
        lint,
        lint_to_hits,
        validate_pack,
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
        "  one_line: Writes plainly and directly.\n"
        "banished:\n"
        "  words: [delve]\n",
        encoding="utf-8",
    )
    (pack / "style-guide.md").write_text("Write plainly. Avoid jargon.\n", encoding="utf-8")
    out = compose_prompt(pack_root=pack, samples=[], draft="Hello world")
    assert "Write plainly" in out and "Hello world" in out
    assert_paired(
        out,
        "Do not use em dashes.",
        "will be read by a text-to-speech engine",
    )
    assert_paired(
        out,
        'Do not use any item in this banished vocabulary list: "delve".',
        "author's established voice",
    )
    assert_paired(
        out,
        "When general craft guidance conflicts with the author's style guide, "
        "follow the style guide.",
        "author's style guide records their established preferences",
    )
    assert_paired(
        out,
        "Scrub the text of LLM-isms before applying the author's style.",
        "Removing formulaic language first",
    )
    assert_paired(
        out,
        "Avoid every AI sentence pattern listed below.",
        "style defects that make prose sound machine-generated",
    )


def test_compose_normalizes_legacy_style_rules_without_changing_context(
    tmp_path: Path,
) -> None:
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
    (pack / "style-guide.md").write_text(
        "# Voice notes\n\n"
        "These observations describe the approved samples.\n\n"
        "Write plainly. Avoid jargon.\n\n"
        "Example:\n"
        "> The shortest useful sentence wins.\n",
        encoding="utf-8",
    )

    prompt = compose_prompt(pack_root=pack, samples=[], draft=None)

    assert "# Voice notes" in prompt
    assert "These observations describe the approved samples." in prompt
    assert "Example:\n> The shortest useful sentence wins." in prompt
    assert_paired(
        prompt,
        "Write plainly.",
        "approved and recognizable voice",
    )
    assert_paired(
        prompt,
        "Avoid jargon.",
        "approved and recognizable voice",
    )


def test_compose_keeps_existing_style_rule_pairs_stable(tmp_path: Path) -> None:
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
    paired = (
        "- Rule: Prefer concrete nouns.\n"
        "  Because: Concrete nouns capture the author's approved voice."
    )
    (pack / "style-guide.md").write_text(
        f"## Diction\n\n{paired}\n",
        encoding="utf-8",
    )

    prompt = compose_prompt(pack_root=pack, samples=[], draft=None)

    assert prompt.count(paired) == 1


def test_compose_normalizes_custom_format_rules_with_surface_reasons(
    tmp_path: Path,
) -> None:
    from blogforge.voice import compose_prompt

    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "formats").mkdir()
    (pack / "stylepack.yaml").write_text(
        'spec_version: "1.0"\n'
        "pack:\n"
        "  slug: test\n"
        "  name: Test Pack\n"
        "  version: 0.1.0\n"
        "  author: Tester\n"
        "persona:\n"
        "  identity: A plain writer.\n"
        "  one_line: Writes plainly and directly.\n"
        "formats:\n"
        "  - name: launch-note\n"
        "    file: formats/launch-note.md\n",
        encoding="utf-8",
    )
    (pack / "style-guide.md").write_text(
        "Rule: Write plainly.\n"
        "Because: Plain language matches the author's approved voice.\n",
        encoding="utf-8",
    )
    (pack / "formats" / "launch-note.md").write_text(
        "## Launch note layout\n\n"
        "Use exactly three bullets.\n"
        "End with a short call to action.\n",
        encoding="utf-8",
    )

    prompt = compose_prompt(
        pack_root=pack,
        format="launch-note",
        samples=[],
        draft=None,
    )

    assert "## Launch note layout" in prompt
    assert_paired(
        prompt,
        "Use exactly three bullets.",
        "selected publishing surface requires this instruction",
    )
    assert_paired(
        prompt,
        "End with a short call to action.",
        "selected publishing surface requires this instruction",
    )

def test_compose_prompt_includes_fingerprint_single_voice_block(tmp_path: Path) -> None:
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
        "  one_line: Writes plainly and directly.\n"
        "samples:\n"
        "  - id: s1\n"
        "    file: samples/s1.md\n"
        "    description: opener\n",
        encoding="utf-8",
    )
    (pack / "style-guide.md").write_text("Write plainly. Avoid jargon.\n", encoding="utf-8")
    (pack / "fingerprint.md").write_text(
        "## Voice fingerprint\nrhythm facts here", encoding="utf-8"
    )
    (pack / "samples").mkdir()
    (pack / "samples" / "s1.md").write_text("> This is my real voice sample.\n", encoding="utf-8")
    # A stray exemplars.md must NOT be read into the prompt any more.
    (pack / "exemplars.md").write_text(
        "## The author's actual writing\n> a real excerpt", encoding="utf-8"
    )

    prompt = compose_prompt(pack_root=pack, format=None, samples=["s1"], draft=None)

    # Fingerprint (the genuinely-new deterministic signal) is folded in.
    assert "Voice fingerprint" in prompt
    # Exactly one verbatim-voice block: the manifest-driven "## Voice exemplars"
    # from _render_samples, and no second overlapping block.
    assert prompt.count("## Voice exemplars") == 1
    assert "This is my real voice sample." in prompt
    assert "author's actual writing" not in prompt
    assert_paired(
        prompt,
        "Match the tone and rhythm of these voice exemplars.",
        "examples capture the author's voice in use",
    )


def test_validate_template_pack() -> None:
    from importlib import resources

    from blogforge.voice import validate_pack
    tmpl = resources.files("blogforge.voice").joinpath("bundled_packs/_template")
    res = validate_pack(Path(str(tmpl)))
    assert res is not None
