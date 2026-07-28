"""Compose a complete LLM prompt from a style pack.

Mirrors `Dan-ai/scripts/compose.sh` semantically but operates on any
SPEC v1.0 pack via its manifest.
"""

from __future__ import annotations

from importlib import resources
from pathlib import Path

import yaml

from blogforge.prompt_rules import (
    FORMAT_INSTRUCTION_RATIONALE,
    PRESERVATION_RATIONALE,
    STYLE_GUIDE_RATIONALE,
    TTS_RATIONALE,
    VOICE_RATIONALE,
    PromptRule,
    normalize_instruction_asset,
    render_prompt_rules,
)
from blogforge.voice.ai_tells import (
    effective_phrases,
    effective_sentence_starters,
    effective_words,
    load_ai_tells,
)
from blogforge.voice.packs.manifest import Manifest


class ComposeError(Exception):
    """Raised when composition cannot complete (e.g., unknown format)."""


# ── mtime-keyed caches ──
# compose() runs on every analyze/fix/generate request and re-read the same
# pack files each time. Pack files change rarely (re-distill / manual edit),
# so cache text and the validated Manifest keyed by (path, mtime). Bounded by
# the number of pack files on disk — effectively constant.
_TEXT_CACHE: dict[str, tuple[float, str]] = {}
_MANIFEST_CACHE: dict[str, tuple[float, Manifest]] = {}


def _read_cached(path: Path) -> str:
    key = str(path)
    mtime = path.stat().st_mtime
    hit = _TEXT_CACHE.get(key)
    if hit is not None and hit[0] == mtime:
        return hit[1]
    text = path.read_text(encoding="utf-8")
    _TEXT_CACHE[key] = (mtime, text)
    return text


def _manifest_cached(manifest_path: Path) -> Manifest:
    key = str(manifest_path)
    mtime = manifest_path.stat().st_mtime
    hit = _MANIFEST_CACHE.get(key)
    if hit is not None and hit[0] == mtime:
        return hit[1]
    manifest = Manifest.model_validate(yaml.safe_load(_read_cached(manifest_path)))
    _MANIFEST_CACHE[key] = (mtime, manifest)
    return manifest


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
    manifest = _manifest_cached(pack_root / "stylepack.yaml")

    if bio is not None:
        return _render_bio(pack_root, manifest, bio)

    parts: list[str] = []
    parts.append(_render_header(manifest))
    parts.append(_render_humanizer(manifest, pack_root))
    parts.append(_render_writing_craft(pack_root))
    parts.append(
        normalize_instruction_asset(
            _read_cached(pack_root / "style-guide.md"),
            default_rationale=STYLE_GUIDE_RATIONALE,
        )
    )

    fingerprint = pack_root / "fingerprint.md"
    if fingerprint.is_file():
        parts.append(
            normalize_instruction_asset(
                _read_cached(fingerprint),
                default_rationale=STYLE_GUIDE_RATIONALE,
            )
        )

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
    body = _read_cached(override) if override.is_file() else _load_default_baseline()
    body = normalize_instruction_asset(
        body,
        default_rationale=STYLE_GUIDE_RATIONALE,
    )
    precedence = render_prompt_rules([
        PromptRule(
            "When general craft guidance conflicts with the author's style guide, "
            "follow the style guide.",
            "The author's style guide records their established preferences and takes precedence.",
        )
    ])
    return (
        "## Section 2: General Writing Craft\n\n"
        "These are general craft defaults.\n\n"
        f"{precedence}\n\n"
        f"{body}"
    )


def _render_header(m: Manifest) -> str:
    tone = m.persona.tone or "authentic to the author's voice"
    intro = (
        f"ROLE: You are {m.persona.identity}. {m.persona.one_line}\n\n"
        "TASK: Rewrite the input text according to the style guide below.\n\n"
    )
    rules = [
        PromptRule(
            "Preserve the input text's meaning, structure, and ideas.",
            PRESERVATION_RATIONALE,
        ),
        PromptRule(
            f"Make the output {tone} and authentic to the author's style guide.",
            VOICE_RATIONALE,
        ),
    ]
    return intro + render_prompt_rules(rules)


def _load_ai_patterns(pack_root: Path) -> str:
    override = pack_root / "ai-patterns.md"
    if override.is_file():
        body = _read_cached(override)
    else:
        body = load_ai_tells().patterns
    return normalize_instruction_asset(
        body,
        default_rationale=STYLE_GUIDE_RATIONALE,
    )


def _render_humanizer(m: Manifest, pack_root: Path) -> str:
    lines: list[str] = ["## Section 1: The Humanizer (Strict Anti-Robot Constraints)\n"]
    lines.append(render_prompt_rules([
        PromptRule(
            "Scrub the text of LLM-isms before applying the author's style.",
            "Removing formulaic language first keeps it from obscuring the author's voice.",
        )
    ]))
    lines.append("")

    words = effective_words(m)
    if words:
        lines.append("**Banished Vocabulary**")
        local_words = m.banished.words
        if local_words:
            joined_local_words = ", ".join(f'"{word}"' for word in local_words)
            lines.append(render_prompt_rules([
                PromptRule(
                    f"Do not use any item in this banished vocabulary list: {joined_local_words}.",
                    "These terms conflict with the author's established voice and "
                    "explicit preferences.",
                )
            ]))
        local_word_keys = {word.lower() for word in local_words}
        shared_words = [word for word in words if word.lower() not in local_word_keys]
        if shared_words:
            lines.append(render_prompt_rules([
                PromptRule(
                    "Do not use any item in the universal AI-tell vocabulary list.",
                    "These terms are recurrent style defects that make prose sound "
                    "machine-generated.",
                )
            ]))
            lines.append(", ".join(shared_words))
        if local_words:
            lines.append(", ".join(local_words))
        lines.append("")

    phrases = effective_phrases(m)
    if phrases:
        lines.append("**Banished Phrases**")
        local_phrases = m.banished.phrases
        if local_phrases:
            joined_local_phrases = ", ".join(f'"{phrase}"' for phrase in local_phrases)
            lines.append(render_prompt_rules([
                PromptRule(
                    f"Do not use any item in this banished phrase list: {joined_local_phrases}.",
                    "These phrases conflict with the author's established voice and "
                    "explicit preferences.",
                )
            ]))
        shared_phrases = [
            phrase for phrase in phrases if phrase.lower() not in {p.lower() for p in local_phrases}
        ]
        if shared_phrases:
            lines.append(render_prompt_rules([
                PromptRule(
                    "Do not use any item in the universal AI-tell phrase list.",
                    "These phrases are recurrent style defects that make prose sound "
                    "machine-generated.",
                )
            ]))
            lines.extend(f'- "{phrase}"' for phrase in shared_phrases)
        if local_phrases:
            lines.extend(f'- "{phrase}"' for phrase in local_phrases)
        lines.append("")

    if m.banished.permitted_exceptions:
        lines.append("**Permitted exceptions**")
        lines.append(render_prompt_rules([
            PromptRule(
                "Allow the following listed exceptions to the banished vocabulary "
                "and phrase rules.",
                "Each listed overlap is intentional and on-brand for the author's voice.",
            )
        ]))
        for ex in m.banished.permitted_exceptions:
            lines.append(f"- *{ex.term}*: {ex.reason}")
        lines.append("")

    rules: list[PromptRule] = []
    if m.rules.no_em_dashes:
        rules.append(PromptRule("Do not use em dashes.", TTS_RATIONALE))
    if m.rules.no_ascii_double_hyphen_between_letters:
        rules.append(PromptRule(
            "Do not use ASCII double-hyphens (`--`) between letters.",
            TTS_RATIONALE,
        ))
    starters = effective_sentence_starters(m)
    if starters:
        joined = ", ".join(f'"{s}"' for s in starters)
        rules.append(PromptRule(
            f"Do not start a sentence with any of these phrases: {joined}.",
            "Repeated stock openers are a recognizable AI-writing tell.",
        ))
    if rules:
        lines.append("**Rules:**")
        lines.append(render_prompt_rules(rules))
        lines.append("")

    if m.pop_culture.allowed or m.pop_culture.banned:
        lines.append("**Pop culture:**")
        if m.pop_culture.allowed:
            lines.append(render_prompt_rules([
                PromptRule(
                    "Use pop-culture references only from this allowed franchise list.",
                    "These references are part of the author's established voice.",
                )
            ], bullet=True))
            lines.append(f"  Allowed franchises: {', '.join(m.pop_culture.allowed)}")
        if m.pop_culture.banned:
            lines.append(render_prompt_rules([
                PromptRule(
                    "Do not use pop-culture references from this banned franchise list.",
                    "These references conflict with the author's established voice "
                    "and preferences.",
                )
            ], bullet=True))
            lines.append(f"  Banned franchises: {', '.join(m.pop_culture.banned)}")
        lines.append("")

    lines.append(render_prompt_rules([
        PromptRule(
            "Avoid every AI sentence pattern listed below.",
            "These patterns are recurrent style defects that make prose sound machine-generated.",
        )
    ]))
    lines.append("")
    lines.append(_load_ai_patterns(pack_root))

    return "\n".join(lines)


def _render_format(pack_root: Path, m: Manifest, name: str) -> str:
    fmt = next((f for f in m.formats if f.name == name), None)
    if fmt is None:
        raise ComposeError(f"format '{name}' not found in pack manifest")
    body = (pack_root / fmt.file).read_text(encoding="utf-8")
    body = normalize_instruction_asset(
        body,
        default_rationale=FORMAT_INSTRUCTION_RATIONALE,
    )
    rule = render_prompt_rules([
        PromptRule(
            "Follow the format-specific instructions below.",
            "The selected publishing format has surface-specific reader and layout requirements.",
        )
    ])
    return f"---\n\n## Additional format-specific instructions\n\n{rule}\n\n{body}"


def _render_samples(pack_root: Path, m: Manifest, ids: list[str]) -> str:
    exemplar_rule = render_prompt_rules([
        PromptRule(
            "Match the tone and rhythm of these voice exemplars.",
            "These examples capture the author's voice in use.",
        )
    ])
    out: list[str] = [f"---\n\n## Voice exemplars\n\n{exemplar_rule}\n"]
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
