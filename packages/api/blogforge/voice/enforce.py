"""Post-generation enforcement of the mechanical voice rules.

The voice rules (no em/en dashes, no ASCII ``--`` between words, banished
words/phrases) are passed into the generation prompt up front — but open models
routinely ignore them. So after a section is generated we:

1. **Detect** any remaining violations deterministically (free, exact).
2. **Repair** by feeding the text back to the same model with the specific
   violations and an instruction to recast it — preserving meaning + voice
   (a human-quality fix, not a dumb substitution).
3. **Backstop** the mechanical tells (em/en dashes, ASCII ``--``) with a
   deterministic substitution so they are *guaranteed* gone even if the model
   ignores the repair too.

Em/en dashes and ASCII ``--`` are treated as universal AI tells and enforced
unconditionally (the whole point of the tool); banished words come from the
active voice's manifest (universal AI-tell lists + the author's own list).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from blogforge.prompt_rules import (
    PRESERVATION_RATIONALE,
    TTS_RATIONALE,
    PromptRule,
    render_prompt_rules,
)
from blogforge.voice.lint import lint
from blogforge.voice.packs.manifest import Manifest

logger = logging.getLogger(__name__)

# Em dash + en dash (en is frequently emitted as an em-dash substitute), with
# any surrounding whitespace collapsed.
_DASH_RE = re.compile(r"\s*[\u2014\u2013]\s*")
# ASCII double-hyphen used as a dash between words.
_ASCII_HYPHEN_RE = re.compile(r"([A-Za-z])--([A-Za-z])")


@dataclass
class RuleViolations:
    em_dash: bool = False
    ascii_hyphen: bool = False
    banished: list[str] = field(default_factory=list)

    @property
    def any(self) -> bool:
        return self.em_dash or self.ascii_hyphen or bool(self.banished)


def detect_violations(manifest: Manifest, text: str) -> RuleViolations:
    """Deterministically find mechanical-rule violations in ``text``."""
    banished = sorted({
        v.match for v in lint(manifest, text) if v.kind in ("word", "phrase")
    })
    return RuleViolations(
        em_dash=bool(re.search(r"[\u2014\u2013]", text)),
        ascii_hyphen=bool(_ASCII_HYPHEN_RE.search(text)),
        banished=banished,
    )


def deterministic_backstop(text: str) -> str:
    """Guarantee the mechanical rules: replace em/en dashes and ASCII ``--``
    between words with a spaced hyphen. Last-resort, applied after the model's
    repair pass so a single em dash can never survive."""
    text = _ASCII_HYPHEN_RE.sub(r"\1 - \2", text)
    text = _DASH_RE.sub(" - ", text)
    return text


def build_repair_prompt(text: str, v: RuleViolations) -> str:
    repair_rules: list[PromptRule] = []
    if v.em_dash:
        repair_rules.append(PromptRule(
            "Remove every em dash (\N{EM DASH}) and en dash (\N{EN DASH}). Recast "
            "each sentence with a period, comma, colon, or parentheses. Do not "
            "swap in another dash.",
            TTS_RATIONALE,
        ))
    if v.ascii_hyphen:
        repair_rules.append(PromptRule(
            "Remove ASCII double-hyphens (`--`) used as dashes; rephrase.",
            TTS_RATIONALE,
        ))
    if v.banished:
        repair_rules.append(PromptRule(
            "Replace these banished words or phrases with plain alternatives: "
            + ", ".join(f'"{b}"' for b in v.banished)
            + ".",
            "These terms conflict with the author's established voice and explicit preferences.",
        ))
    repair_rules.extend([
        PromptRule(
            "Fix only the listed violations.",
            "This repair is intentionally bounded to avoid changing approved prose.",
        ),
        PromptRule(
            "Preserve the meaning, structure, ideas, and author's voice.",
            PRESERVATION_RATIONALE,
        ),
        PromptRule(
            "Do not add commentary or a preamble.",
            "Downstream code replaces the original passage with this response.",
        ),
        PromptRule(
            "Return only the corrected text.",
            "Downstream code replaces the original passage with this response.",
        ),
    ])
    return (
        "The text below must follow these constraints but currently breaks them:\n"
        + render_prompt_rules(repair_rules, bullet=True)
        + "\n\n"
        "TEXT:\n" + text
    )


async def enforce_voice_rules(text: str, manifest: Manifest, provider, model: str) -> str:
    """Detect rule violations, repair via the model, then deterministically
    backstop the mechanical tells. Returns the (possibly unchanged) text.

    Best-effort: if the repair call fails, the deterministic backstop still
    guarantees the em/en-dash + ASCII ``--`` rules.
    """
    v = detect_violations(manifest, text)
    if not v.any:
        return text

    repaired = text
    try:
        resp = await provider.complete(model=model, prompt=build_repair_prompt(text, v))
        candidate = (resp.text or "").strip()
        # Trust the recast only if it's a similar length — guards against a weak
        # model that truncates, pads, or prepends commentary instead of just
        # fixing. Otherwise keep the original; the backstop still runs.
        if candidate and 0.5 * len(text) <= len(candidate) <= 2.0 * len(text):
            repaired = candidate
        elif candidate:
            logger.warning(
                "voice-rule repair rejected (len %d vs %d); keeping original",
                len(candidate),
                len(text),
            )
    except Exception as exc:
        logger.warning("voice-rule repair pass failed (%r); applying backstop", exc)

    return deterministic_backstop(repaired)
