"""Compose a complete LLM prompt from a style pack.

Mirrors `Dan-ai/scripts/compose.sh` semantically but operates on any
SPEC v1.0 pack via its manifest.
"""

from __future__ import annotations

from importlib import resources
from pathlib import Path

import yaml

from blogforge.voice.ai_tells import (
    effective_phrases,
    effective_sentence_starters,
    effective_words,
    load_ai_tells,
)
from blogforge.voice.packs.manifest import Manifest


class ComposeError(Exception):
    """Raised when composition cannot complete (e.g., unknown format)."""


def compose(
    pack_root: Path,
    *,
    format: str | None = None,
    samples: list[str] | None = None,
    draft: str | None = None,
    bio: str | None = None,
) -> str:
    """Assemble the prompt text for a pack.

    Modes:
    - Prompt mode (default): emit ROLE + Humanizer + style guide + optional
      format add-on + optional voice exemplars + optional draft trailer.
    - Bio mode (`bio=` set): emit just the bio body. Other args ignored.
    """
    manifest_path = pack_root / "stylepack.yaml"
    manifest = Manifest.model_validate(
        yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    )

    if bio is not None:
        return _render_bio(pack_root, manifest, bio)

    parts: list[str] = []
    parts.append(_render_header(manifest))
    parts.append(_render_humanizer(manifest, pack_root))
    parts.append(_render_writing_craft(pack_root))
    parts.append((pack_root / "style-guide.md").read_text(encoding="utf-8"))

    if format is not None:
        parts.append(_render_format(pack_root, manifest, format))

    if samples:
        parts.append(_render_samples(pack_root, manifest, samples))

    if draft is not None:
        parts.append(_render_draft(draft))

    return "\n\n".join(p.rstrip() for p in parts) + "\n"


def _load_default_baseline() -> str:
    """Read the shared writing-craft baseline bundled in the package."""
    return (
        resources.files("blogforge.voice")
        .joinpath("assets/writing-baseline.md")
        .read_text(encoding="utf-8")
    )


def _render_writing_craft(pack_root: Path) -> str:
    override = pack_root / "writing-baseline.md"
    body = (
        override.read_text(encoding="utf-8")
        if override.is_file()
        else _load_default_baseline()
    )
    return (
        "## Section 2: General Writing Craft\n\n"
        "These are general craft defaults. Where the author's style guide "
        "below conflicts, the style guide wins.\n\n"
        f"{body}"
    )


def _render_header(m: Manifest) -> str:
    tone = m.persona.tone or "authentic to the author's voice"
    return (
        f"ROLE: You are {m.persona.identity}. {m.persona.one_line}\n\n"
        "TASK: Rewrite the input text to be 100% authentic to the style guide "
        f"below. The output must be {tone}."
    )


def _load_ai_patterns(pack_root: Path) -> str:
    override = pack_root / "ai-patterns.md"
    if override.is_file():
        return override.read_text(encoding="utf-8")
    return load_ai_tells().patterns


def _render_humanizer(m: Manifest, pack_root: Path) -> str:
    lines: list[str] = ["## Section 1: The Humanizer (Strict Anti-Robot Constraints)\n"]
    lines.append("Before applying style, you must scrub the text of LLM-isms:\n")

    words = effective_words(m)
    if words:
        lines.append("**Banished Vocabulary** (do NOT use):")
        lines.append(", ".join(words))
        lines.append("")

    phrases = effective_phrases(m)
    if phrases:
        lines.append("**Banished Phrases** (strike on sight):")
        for ph in phrases:
            lines.append(f'- "{ph}"')
        lines.append("")

    if m.banished.permitted_exceptions:
        lines.append("**Permitted exceptions** (on-brand overlaps with AI tells):")
        for ex in m.banished.permitted_exceptions:
            lines.append(f"- *{ex.term}*: {ex.reason}")
        lines.append("")

    rules: list[str] = []
    if m.rules.no_em_dashes:
        rules.append("No em dashes.")
    if m.rules.no_ascii_double_hyphen_between_letters:
        rules.append("No ASCII double-hyphen (`--`) between letters.")
    starters = effective_sentence_starters(m)
    if starters:
        joined = ", ".join(f'"{s}"' for s in starters)
        rules.append(f"No sentence starts with: {joined}.")
    if rules:
        lines.append("**Rules:**")
        for r in rules:
            lines.append(f"- {r}")
        lines.append("")

    if m.pop_culture.allowed or m.pop_culture.banned:
        lines.append("**Pop culture:**")
        if m.pop_culture.allowed:
            lines.append(f"- Allowed franchises: {', '.join(m.pop_culture.allowed)}")
        if m.pop_culture.banned:
            lines.append(f"- Banned franchises: {', '.join(m.pop_culture.banned)}")
        lines.append("")

    lines.append("**Avoid these AI sentence patterns:**\n")
    lines.append(_load_ai_patterns(pack_root))

    return "\n".join(lines)


def _render_format(pack_root: Path, m: Manifest, name: str) -> str:
    fmt = next((f for f in m.formats if f.name == name), None)
    if fmt is None:
        raise ComposeError(f"format '{name}' not found in pack manifest")
    body = (pack_root / fmt.file).read_text(encoding="utf-8")
    return f"---\n\n## Additional format-specific instructions\n\n{body}"


def _render_samples(pack_root: Path, m: Manifest, ids: list[str]) -> str:
    out: list[str] = ["---\n\n## Voice exemplars (match the tone and rhythm of these)\n"]
    for sid in ids:
        sample = next((s for s in m.samples if s.id == sid), None)
        if sample is None:
            raise ComposeError(f"sample '{sid}' not found in pack manifest")
        body = (pack_root / sample.file).read_text(encoding="utf-8")
        out.append(f"### From: {Path(sample.file).stem}\n")
        for line in body.splitlines():
            if line.startswith("> "):
                out.append(line[2:])
            elif line.strip() == ">":
                out.append("")
        out.append("")
    return "\n".join(out)


def _render_draft(draft: str) -> str:
    return f"---\n\n**INPUT TEXT TO REWRITE:**\n\n{draft}"


def _render_bio(pack_root: Path, m: Manifest, name: str) -> str:
    bio = next((b for b in m.bios if b.name == name), None)
    if bio is None:
        raise ComposeError(f"bio '{name}' not found in pack manifest")
    body = (pack_root / bio.file).read_text(encoding="utf-8")
    # Strip author notes: italic-only lines like "*155 characters.*"
    kept = [
        line for line in body.splitlines()
        if not (line.strip().startswith("*") and line.strip().endswith("*"))
    ]
    # Extract blockquote body; strip "> " prefix
    out: list[str] = []
    for line in kept:
        if line.startswith("> "):
            out.append(line[2:])
        elif line.strip() == ">":
            out.append("")
    return "\n".join(out).strip() + "\n"
