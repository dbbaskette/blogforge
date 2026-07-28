# Model-facing Rule Rationales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every explicit rule sent to a language model an adjacent, operational `Because:` rationale, including the text-to-speech reason for punctuation rules.

**Architecture:** Add one immutable `PromptRule` value object and renderer at the shared API package level, then use it for Python-built constraint blocks. Keep Jinja and Markdown prompt sources readable by writing literal `Rule:` / `Because:` pairs, and protect all prompt families with focused assertions plus an explicit source inventory.

**Tech Stack:** Python 3.11+, frozen dataclasses, Jinja2 prompt templates, pytest, Ruff, Bash/Node version tooling.

## Global Constraints

- Every explicit model-facing prohibition, preservation constraint, output contract, continuity requirement, style constraint, and repair instruction has an adjacent `Because:` rationale.
- Task descriptions, source material, examples, contextual facts, and comments that are not sent to a model do not need rationales.
- Use the exact labels `Rule:` and `Because:`.
- Split compound instructions when their independently testable constraints have different reasons.
- Punctuation rules say the text will be read by a text-to-speech engine and disruptive punctuation can produce confusing pauses or phrasing.
- Rationales are prompt metadata and must not be copied into generated article prose.
- User-entered banished vocabulary is grouped under one rule and one rationale; do not create a rationale for each word.
- Keep deterministic linting, schema parsing, source checks, and punctuation backstops unchanged.
- Add no database, API, or frontend schema.
- Increment the release from `0.8.1` to `0.8.2`.
- Follow the repository testing cadence: implement a coherent prompt-family increment, run its focused tests, and run the complete API suite once at the end.

---

## File Structure

### Shared rule infrastructure

- Create `packages/api/blogforge/prompt_rules.py`: immutable rule type, validation, renderer, and reusable rationale constants.
- Create `packages/api/tests/test_prompt_rules.py`: unit coverage for construction, rendering, ordering, and shared rationale text.

### Voice prompt family

- Modify `packages/api/blogforge/voice/compose.py`: header, humanizer, user vocabulary, punctuation, AI-pattern, format, and output rules.
- Modify `packages/api/blogforge/voice/enforce.py`: post-generation repair rules.
- Modify `packages/api/blogforge/voice/guide.py`: portable guide instructions and grouped banished vocabulary.
- Modify `packages/api/blogforge/voice/distill.py`: style-guide analysis and output contract.
- Modify `packages/api/blogforge/voice/fingerprint.py`: rhythm and phrase guidance.
- Modify `packages/api/blogforge/voice/linkedin_import.py`: persona output contract.
- Modify `packages/api/blogforge/voice/assets/writing-baseline.md`: general writing rules.
- Modify `packages/api/blogforge/voice/assets/ai-tells/patterns.md`: structural anti-AI rules.
- Modify `packages/api/blogforge/voice/assets/humanize/lenses.md`: humanization and preservation rules.
- Modify the matching tests under `packages/api/tests/voice/`.

### Long-form planning and generation

- Modify `packages/api/blogforge/generate/builtin_formats.py`: built-in article-structure and section-context rules.
- Modify `packages/api/blogforge/generate/prompts/document.j2`: complete-document continuity, structure, length, voice, and output rules.
- Modify `packages/api/blogforge/generate/prompts/outline.j2`: progression, overlap, section budget, schema, and voice rules.
- Modify `packages/api/blogforge/generate/prompts/section.j2`: section continuity, boundaries, openings, voice, and output rules.
- Modify `packages/api/blogforge/generate/prompts/section_revise.j2`: surgical-edit, preservation, continuity, voice, and output rules.
- Modify `packages/api/blogforge/generate/ideation.py`: direct ideation and interview constraints.
- Modify `packages/api/tests/generate/test_builtin_formats.py` and the matching
  long-form tests under `packages/api/tests/generate/` and
  `packages/api/tests/test_ideation.py`.

### Editorial and derived-output prompts

- Modify `packages/api/blogforge/generate/claims.py`.
- Modify `packages/api/blogforge/generate/headlines.py`.
- Modify `packages/api/blogforge/generate/hero.py`.
- Modify `packages/api/blogforge/generate/humanize.py`.
- Modify `packages/api/blogforge/generate/inline.py`.
- Modify `packages/api/blogforge/generate/repurpose.py`.
- Modify `packages/api/blogforge/generate/suggest.py`.
- Modify `packages/api/blogforge/generate/topics.py`.
- Modify their focused tests under `packages/api/tests/generate/`.

### GEO prompt family

- Modify `packages/api/blogforge/generate/geo.py`: semantic audit contract and all generated fixes or derived outputs.
- Modify `packages/api/tests/generate/test_geo.py`: semantic and helper prompt assertions.

### Audit and release

- Create `packages/api/tests/test_prompt_rule_inventory.py`: explicit production prompt-source inventory and source-class contract checks.
- Modify `CHANGELOG.md`: release note for rationale-backed model rules.
- Modify `packages/web/package.json` and `packages/api/blogforge/__init__.py` through `scripts/version.sh 0.8.2`.

---

### Task 1: Shared prompt-rule contract

**Files:**

- Create: `packages/api/blogforge/prompt_rules.py`
- Create: `packages/api/tests/test_prompt_rules.py`

**Interfaces:**

- Produces: `PromptRule(instruction: str, rationale: str)`.
- Produces: `render_prompt_rules(rules: Sequence[PromptRule], *, bullet: bool = False) -> str`.
- Produces: `TTS_RATIONALE`, `FACTUAL_RATIONALE`, `PRESERVATION_RATIONALE`, `OUTPUT_RATIONALE`, `CONTINUITY_RATIONALE`, and `VOICE_RATIONALE`.
- Validation: construction raises `ValueError("prompt rule instruction must not be blank")` or `ValueError("prompt rule rationale must not be blank")`.

- [ ] **Step 1: Add focused contract tests**

Create `packages/api/tests/test_prompt_rules.py` with exact behavior:

```python
from __future__ import annotations

import pytest

from blogforge.prompt_rules import PromptRule, TTS_RATIONALE, render_prompt_rules


def test_renders_adjacent_rule_and_reason() -> None:
    rendered = render_prompt_rules(
        [
            PromptRule("Do not use em dashes.", TTS_RATIONALE),
            PromptRule("Return only JSON.", "Downstream code parses this response."),
        ]
    )
    assert rendered == (
        "Rule: Do not use em dashes.\n"
        f"Because: {TTS_RATIONALE}\n\n"
        "Rule: Return only JSON.\n"
        "Because: Downstream code parses this response."
    )


def test_bullet_renderer_keeps_each_reason_with_its_rule() -> None:
    rendered = render_prompt_rules(
        [PromptRule("Preserve every quotation.", "The edit must retain the factual record.")],
        bullet=True,
    )
    assert rendered == (
        "- Rule: Preserve every quotation.\n"
        "  Because: The edit must retain the factual record."
    )


@pytest.mark.parametrize(
    ("instruction", "rationale", "message"),
    [
        (" ", "reason", "prompt rule instruction must not be blank"),
        ("instruction", "\n", "prompt rule rationale must not be blank"),
    ],
)
def test_rejects_blank_values(instruction: str, rationale: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        PromptRule(instruction, rationale)


def test_tts_rationale_describes_guaranteed_consuming_surface() -> None:
    assert "will be read by a text-to-speech engine" in TTS_RATIONALE
    assert "confusing pauses or phrasing" in TTS_RATIONALE
```

- [ ] **Step 2: Implement the immutable rule and renderer**

Create `packages/api/blogforge/prompt_rules.py`:

```python
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

TTS_RATIONALE = (
    "This text will be read by a text-to-speech engine, and disruptive "
    "punctuation can produce confusing pauses or phrasing."
)
FACTUAL_RATIONALE = (
    "Unsupported material damages factual trust and makes attribution unreliable."
)
PRESERVATION_RATIONALE = (
    "This is a bounded edit and must not damage the approved article."
)
OUTPUT_RATIONALE = (
    "Downstream code parses this response, so extra or malformed content breaks the workflow."
)
CONTINUITY_RATIONALE = (
    "These sections form one continuous article, so repetition makes the argument restart."
)
VOICE_RATIONALE = (
    "The result must retain the author's recognizable voice instead of sounding templated."
)


@dataclass(frozen=True)
class PromptRule:
    instruction: str
    rationale: str

    def __post_init__(self) -> None:
        if not self.instruction.strip():
            raise ValueError("prompt rule instruction must not be blank")
        if not self.rationale.strip():
            raise ValueError("prompt rule rationale must not be blank")


def render_prompt_rules(
    rules: Sequence[PromptRule],
    *,
    bullet: bool = False,
) -> str:
    if bullet:
        return "\n".join(
            f"- Rule: {rule.instruction.strip()}\n"
            f"  Because: {rule.rationale.strip()}"
            for rule in rules
        )
    return "\n\n".join(
        f"Rule: {rule.instruction.strip()}\n"
        f"Because: {rule.rationale.strip()}"
        for rule in rules
    )
```

- [ ] **Step 3: Run the shared contract tests**

Run:

```bash
uv run pytest packages/api/tests/test_prompt_rules.py -q
uv run ruff check packages/api/blogforge/prompt_rules.py packages/api/tests/test_prompt_rules.py
```

Expected: all prompt-rule tests pass and Ruff reports no errors.

- [ ] **Step 4: Commit the shared contract**

```bash
git add packages/api/blogforge/prompt_rules.py packages/api/tests/test_prompt_rules.py
git commit -m "feat: add rationale-backed prompt rules"
```

---

### Task 2: Voice composition, repair, and portable guides

**Files:**

- Modify: `packages/api/blogforge/voice/compose.py`
- Modify: `packages/api/blogforge/voice/enforce.py`
- Modify: `packages/api/blogforge/voice/guide.py`
- Modify: `packages/api/blogforge/voice/distill.py`
- Modify: `packages/api/blogforge/voice/fingerprint.py`
- Modify: `packages/api/blogforge/voice/linkedin_import.py`
- Modify: `packages/api/blogforge/voice/assets/writing-baseline.md`
- Modify: `packages/api/blogforge/voice/assets/ai-tells/patterns.md`
- Modify: `packages/api/blogforge/voice/assets/humanize/lenses.md`
- Modify: `packages/api/tests/voice/test_absorb.py`
- Modify: `packages/api/tests/voice/test_enforce.py`
- Modify: `packages/api/tests/voice/test_guide.py`
- Modify: `packages/api/tests/voice/test_voice_distill.py`
- Modify: `packages/api/tests/voice/test_fingerprint.py`
- Modify: `packages/api/tests/voice/test_linkedin_import.py`
- Modify: `packages/api/tests/voice/test_ai_tells_assets.py`

**Interfaces:**

- Consumes: `PromptRule`, `render_prompt_rules`, and shared rationale constants from Task 1.
- Keeps: all existing public function signatures.
- Produces: voice prompts and portable guides where each rule is immediately followed by its reason.

- [ ] **Step 1: Expand focused voice assertions**

Add assertions that exercise the rendered prompts, not merely source text:

```python
def assert_paired(prompt: str, instruction: str, rationale_fragment: str) -> None:
    pair = f"Rule: {instruction}\nBecause: "
    assert pair in prompt
    assert rationale_fragment in prompt[prompt.index(pair):]
```

Cover these exact cases in the existing test modules:

```python
assert_paired(
    prompt,
    "Do not use em dashes.",
    "will be read by a text-to-speech engine",
)
assert_paired(
    prompt,
    'Do not use any item in this banished vocabulary list: "delve".',
    "author's established voice",
)
assert "Rule: Return only the corrected text." in repair_prompt
assert "Because: Downstream code replaces the original passage" in repair_prompt
assert "Rule: Match this sentence-length distribution" in fingerprint
assert "Because: Flattening the rhythm changes the author's recognizable cadence" in fingerprint
assert "Rule: Return JSON with exactly `identity`, `one_line`, and `tone`." in persona_prompt
assert "Because: Downstream code parses these fields" in persona_prompt
```

For bundled Markdown assets, assert each imperative bullet is represented as a
paired block and the punctuation block contains the TTS reason.

- [ ] **Step 2: Convert Python-built voice rules**

In `compose.py`, render the humanizer with structured rules. Group dynamic
vocabulary and phrases, preserve permitted exception reasons, and keep the
lists as data following their governing rule:

```python
rules = [
    PromptRule(
        f"Do not use any item in this banished vocabulary list: {joined_words}.",
        "These terms conflict with the author's established voice and explicit preferences.",
    ),
    PromptRule("Do not use em dashes.", TTS_RATIONALE),
    PromptRule(
        "Do not use ASCII double-hyphens (`--`) between letters.",
        TTS_RATIONALE,
    ),
]
lines.append(render_prompt_rules(rules, bullet=True))
```

Give the header rewrite task separate preservation and voice pairs. Introduce
format-pack text as externally supplied instructions, but precede it with:

```python
PromptRule(
    "Follow the format-specific instructions below.",
    "The selected publishing format has surface-specific reader and layout requirements.",
)
```

In `enforce.py`, create one `PromptRule` per detected violation and separate the
repair constraints:

```python
repair_rules.extend(
    [
        PromptRule(
            "Fix only the listed violations.",
            "This repair is intentionally bounded to avoid changing approved prose.",
        ),
        PromptRule(
            "Preserve the meaning, structure, ideas, and author's voice.",
            PRESERVATION_RATIONALE,
        ),
        PromptRule(
            "Return only the corrected text without commentary or a preamble.",
            "Downstream code replaces the original passage with this response.",
        ),
    ]
)
```

Convert `guide.py`, `distill.py`, `fingerprint.py`, and
`linkedin_import.py` in the same way. A portable guide must explain that its
`Rule:` and `Because:` labels are instructions and should not be copied into
article output.

- [ ] **Step 3: Convert bundled Markdown rule assets**

Rewrite each model instruction in the three assets as literal adjacent pairs:

```markdown
- Rule: Do not use em dashes or en dashes.
  Because: This text will be read by a text-to-speech engine, and disruptive punctuation can produce confusing pauses or phrasing.
```

Use style-defect reasons for AI-tell patterns, preservation reasons for
humanization guardrails, and reader-comprehension reasons for general craft.
Do not add reasons to examples or descriptive headings.

- [ ] **Step 4: Run the complete voice prompt-family tests**

Run:

```bash
uv run pytest \
  packages/api/tests/test_prompt_rules.py \
  packages/api/tests/voice/test_absorb.py \
  packages/api/tests/voice/test_enforce.py \
  packages/api/tests/voice/test_guide.py \
  packages/api/tests/voice/test_voice_distill.py \
  packages/api/tests/voice/test_fingerprint.py \
  packages/api/tests/voice/test_linkedin_import.py \
  packages/api/tests/voice/test_ai_tells_assets.py -q
uv run ruff check packages/api/blogforge/voice packages/api/tests/voice
```

Expected: all selected tests pass and Ruff reports no errors.

- [ ] **Step 5: Commit the voice family**

```bash
git add packages/api/blogforge/voice packages/api/tests/voice
git commit -m "feat: explain model-facing voice rules"
```

---

### Task 3: Long-form planning, drafting, and revision

**Files:**

- Modify: `packages/api/blogforge/generate/builtin_formats.py`
- Modify: `packages/api/blogforge/generate/prompts/document.j2`
- Modify: `packages/api/blogforge/generate/prompts/outline.j2`
- Modify: `packages/api/blogforge/generate/prompts/section.j2`
- Modify: `packages/api/blogforge/generate/prompts/section_revise.j2`
- Modify: `packages/api/blogforge/generate/ideation.py`
- Modify: `packages/api/tests/generate/test_builtin_formats.py`
- Modify: `packages/api/tests/generate/test_document.py`
- Modify: `packages/api/tests/generate/test_outline.py`
- Modify: `packages/api/tests/generate/test_section.py`
- Modify: `packages/api/tests/test_ideation.py`
- Modify: `packages/api/tests/test_ideation_round_trip.py`
- Modify: `packages/api/tests/test_interview_mode.py`

**Interfaces:**

- Consumes: literal `Rule:` / `Because:` format in Jinja templates.
- Consumes: `PromptRule` renderer for Python ideation blocks.
- Consumes: `PromptRule` renderer for built-in format and single-section format rules.
- Keeps: `_render_document_prompt`, `_render_outline_prompt`, `_render_section_prompt`, `_render_revise_prompt`, and `build_ideation_prompt` signatures.

- [ ] **Step 1: Add long-form prompt assertions**

Update current wording assertions to validate reasons:

```python
assert (
    "Rule: Never restate a point, example, metaphor, or stock phrase from an "
    "earlier section.\nBecause: These sections form one continuous article"
) in rendered
assert (
    "Rule: Use each supplied section title verbatim as an `##` heading in the "
    "given order.\nBecause: BlogForge maps the generated document back"
) in rendered
assert (
    "Rule: Return only the post body as Markdown.\nBecause: Downstream code "
    "splits the response into editable sections"
) in rendered
```

For built-in formats, outline, section, and revision prompts, assert
surface-specific structure, progression, future-section
boundaries, verbatim preservation, banished vocabulary, and output contracts
each have a nearby rationale. For ideation and interview mode, assert exact
question count, no premature outline, JSON timing/schema, and non-overlap rules
are each paired.

- [ ] **Step 2: Convert the four Jinja templates**

Replace prose rule bundles with explicit pairs. For example,
`document.j2` contains separate blocks:

```text
Rule: Write the post as one continuous argument in which every section advances what came before.
Because: Independent mini-essays create visible seams and a repetitive reading experience.

Rule: Never restate a point, example, metaphor, or stock phrase from an earlier section.
Because: These sections form one continuous article, so repetition makes the argument restart.

Rule: Use each supplied section title verbatim as an `##` heading in the given order.
Because: BlogForge maps the generated document back into section records by heading order.

Rule: Return only the post body as Markdown.
Because: Downstream code splits the response into editable sections and process commentary would become article text.
```

Split every multi-clause template rule when the reason differs. Keep title,
outline, prior prose, future briefs, current content, and author notes as
context, not as rules.

- [ ] **Step 3: Convert built-in formats**

Render each `BUILTIN_FORMATS[*]["directive"]` from a format task plus paired
rules. Each format uses reasons tied to its consuming structure. For example:

```python
render_prompt_rules(
    [
        PromptRule(
            "Use numbered steps where each step is one action with its expected result.",
            "Tutorial readers need to execute and verify one operation at a time.",
        ),
        PromptRule(
            "Close with verification guidance and one common pitfall.",
            "Readers need to confirm success and recover from the most likely failure.",
        ),
    ],
    bullet=True,
)
```

In `builtin_format_section_note`, pair “write only the current section” with
the reason that BlogForge stores and regenerates sections independently.

- [ ] **Step 4: Convert direct ideation and interview blocks**

Build `IDEATION_SYSTEM_BLOCK` and `INTERVIEW_SYSTEM_BLOCK` from task/context
text plus `render_prompt_rules`. The interview rules include:

```python
PromptRule(
    "Ask exactly one focused question per reply.",
    "One concrete question keeps the interview easy to answer and preserves turn-by-turn state.",
)
PromptRule(
    "Do not write the piece or propose an outline while information is still missing.",
    "Premature drafting locks in assumptions before the author's intent is known.",
)
PromptRule(
    "Emit no JSON until announcing that enough information has been gathered.",
    "The client treats JSON as the transition from interview mode to outline review.",
)
```

The direct ideation block uses continuity, non-overlap, author-voice, and
schema-parser rationales.

- [ ] **Step 5: Run the long-form milestone**

Run:

```bash
uv run pytest \
  packages/api/tests/generate/test_builtin_formats.py \
  packages/api/tests/generate/test_document.py \
  packages/api/tests/generate/test_outline.py \
  packages/api/tests/generate/test_section.py \
  packages/api/tests/test_ideation.py \
  packages/api/tests/test_ideation_round_trip.py \
  packages/api/tests/test_interview_mode.py -q
uv run ruff check \
  packages/api/blogforge/generate/document.py \
  packages/api/blogforge/generate/builtin_formats.py \
  packages/api/blogforge/generate/outline.py \
  packages/api/blogforge/generate/section.py \
  packages/api/blogforge/generate/ideation.py \
  packages/api/tests/generate/test_document.py \
  packages/api/tests/generate/test_builtin_formats.py \
  packages/api/tests/generate/test_outline.py \
  packages/api/tests/generate/test_section.py \
  packages/api/tests/test_ideation.py
```

Expected: the full long-form prompt family passes.

- [ ] **Step 6: Commit the long-form family**

```bash
git add \
  packages/api/blogforge/generate/builtin_formats.py \
  packages/api/blogforge/generate/prompts \
  packages/api/blogforge/generate/ideation.py \
  packages/api/tests/generate/test_builtin_formats.py \
  packages/api/tests/generate/test_document.py \
  packages/api/tests/generate/test_outline.py \
  packages/api/tests/generate/test_section.py \
  packages/api/tests/test_ideation.py \
  packages/api/tests/test_ideation_round_trip.py \
  packages/api/tests/test_interview_mode.py
git commit -m "feat: explain long-form generation rules"
```

---

### Task 4: Editorial transforms and derived content

**Files:**

- Modify: `packages/api/blogforge/generate/claims.py`
- Modify: `packages/api/blogforge/generate/headlines.py`
- Modify: `packages/api/blogforge/generate/hero.py`
- Modify: `packages/api/blogforge/generate/humanize.py`
- Modify: `packages/api/blogforge/generate/inline.py`
- Modify: `packages/api/blogforge/generate/repurpose.py`
- Modify: `packages/api/blogforge/generate/suggest.py`
- Modify: `packages/api/blogforge/generate/topics.py`
- Modify: `packages/api/tests/generate/test_claims.py`
- Modify: `packages/api/tests/generate/test_headlines.py`
- Modify: `packages/api/tests/generate/test_hero.py`
- Modify: `packages/api/tests/generate/test_humanize.py`
- Modify: `packages/api/tests/generate/test_inline.py`
- Modify: `packages/api/tests/generate/test_repurpose.py`
- Modify: `packages/api/tests/generate/test_suggest.py`
- Modify: `packages/api/tests/generate/test_topics.py`

**Interfaces:**

- Consumes: shared rule renderer and rationale constants.
- Keeps: every existing prompt-builder and async operation signature.
- Produces: parser-safe and fact-preserving editorial prompts with tailored reasons.

- [ ] **Step 1: Add one rationale assertion per independent rule category**

Add focused prompt tests covering:

```python
assert "Rule: Judge claims only against the attached sources." in prompt
assert "Because: Unsupported material damages factual trust" in prompt
assert "Rule: Return JSON matching the claims schema." in prompt
assert "Because: Downstream code parses this response" in prompt

assert "Rule: Ground every headline option in this post." in prompt
assert "Because: A headline for a different topic misrepresents the article" in prompt

assert "Rule: The image must contain no text, letters, words, or logos." in prompt
assert "Because: Generated lettering is unreliable" in prompt

assert "Rule: Preserve every number, URL, and quoted span." in prompt
assert "Because: Humanization must not alter the article's factual record" in prompt

assert "Rule: Return exactly one rewritten passage and nothing else." in prompt
assert "Because: The editor replaces the selected text with this response" in prompt
```

Add prompt-builder tests to `suggest.py` and `topics.py`; their current tests
only cover parsers. Capture the provider prompt or expose their existing
builder through the narrowest private function consistent with the modules'
current style.

- [ ] **Step 2: Convert fact-sensitive and parser-sensitive prompts**

Use `render_prompt_rules` in `claims.py`, `humanize.py`, `inline.py`,
`suggest.py`, and `topics.py`. Separate factual grounding, preservation, voice,
scope, and JSON/output contracts:

```python
rules = [
    PromptRule(
        "Preserve every number, URL, and quoted span.",
        "Humanization must not alter the article's factual record.",
    ),
    PromptRule(
        "Return findings as JSON matching the supplied schema.",
        OUTPUT_RATIONALE,
    ),
    PromptRule(
        "Do not copy the `Rule` or `Because` labels into suggestions.",
        "Those labels are prompt metadata rather than article prose.",
    ),
]
```

Keep post text, reference material, seed topics, and response schema examples
outside the rule renderer.

- [ ] **Step 3: Convert headline, hero, and repurposing prompts**

In `headlines.py`, give distinct reasons for variety, grounding, no clickbait,
voice, banished vocabulary, and JSON. In `hero.py`, separate visual subject,
no-lettering, wide composition, and output-only rules; use a rendering-quality
reason rather than the TTS rationale because this output is an image prompt.

In `repurpose.py`, retain each channel directive but convert its explicit
constraints into paired rules. Shared global pairs are:

```python
PromptRule(
    "Use only facts present in the source article.",
    "Repurposed content must not introduce unsupported claims under the author's name.",
)
PromptRule(
    "Follow the selected channel's length and formatting limits.",
    "The consuming surface truncates or misrenders content outside those limits.",
)
```

- [ ] **Step 4: Run the editorial milestone**

Run:

```bash
uv run pytest \
  packages/api/tests/generate/test_claims.py \
  packages/api/tests/generate/test_headlines.py \
  packages/api/tests/generate/test_hero.py \
  packages/api/tests/generate/test_humanize.py \
  packages/api/tests/generate/test_inline.py \
  packages/api/tests/generate/test_inline_clean.py \
  packages/api/tests/generate/test_repurpose.py \
  packages/api/tests/generate/test_suggest.py \
  packages/api/tests/generate/test_topics.py -q
uv run ruff check \
  packages/api/blogforge/generate/claims.py \
  packages/api/blogforge/generate/headlines.py \
  packages/api/blogforge/generate/hero.py \
  packages/api/blogforge/generate/humanize.py \
  packages/api/blogforge/generate/inline.py \
  packages/api/blogforge/generate/repurpose.py \
  packages/api/blogforge/generate/suggest.py \
  packages/api/blogforge/generate/topics.py \
  packages/api/tests/generate
```

Expected: all editorial prompt and parser tests pass.

- [ ] **Step 5: Commit the editorial family**

```bash
git add \
  packages/api/blogforge/generate/claims.py \
  packages/api/blogforge/generate/headlines.py \
  packages/api/blogforge/generate/hero.py \
  packages/api/blogforge/generate/humanize.py \
  packages/api/blogforge/generate/inline.py \
  packages/api/blogforge/generate/repurpose.py \
  packages/api/blogforge/generate/suggest.py \
  packages/api/blogforge/generate/topics.py \
  packages/api/tests/generate
git commit -m "feat: explain editorial model rules"
```

---

### Task 5: GEO analysis and generated fixes

**Files:**

- Modify: `packages/api/blogforge/generate/geo.py`
- Modify: `packages/api/tests/generate/test_geo.py`
- Modify: `packages/api/tests/generate/test_geo_new_levers.py`

**Interfaces:**

- Consumes: shared prompt-rule renderer and rationale constants.
- Keeps: GEO schemas, scoring, parsing, deterministic augmentation, and every public async function signature unchanged.
- Produces: rationale-backed semantic analysis, FAQ, opener, table, quote, takeaway, alt-text, query, and citation prompts.

- [ ] **Step 1: Add a prompt recorder and focused GEO assertions**

Reuse the existing provider capture pattern and exercise every LLM entry point.
The tests assert the following rule/reason families:

```python
EXPECTED_GEO_PAIRS = (
    ("Score the draft without rewriting it.", "The analysis panel needs findings against the existing draft."),
    ("Never invent facts, statistics, brands, sources, data, or quotations.", "Unsupported material damages factual trust"),
    ("Use verbatim draft text for passage-level targets.", "The client locates findings by exact text"),
    ("Return JSON matching the supplied semantic schema.", "Downstream code parses this response"),
)
```

Add one async capture test for each generator:

- `generate_faq`: draft-only grounding, skip unsupported questions, JSON.
- `generate_opener`: one sentence, draft grounding, output only.
- `generate_table`: source-section facts only, Markdown table only.
- `generate_quotes`: exact copying, length/count, JSON.
- `generate_takeaways`: grounded, standalone, voice, JSON.
- `generate_alt_text`: under 120 characters, no boilerplate, output only.
- `generate_queries`: actual covered topics only, count, JSON.
- `generate_citation`: attribution-only bounded rewrite, quote preservation, output only.

- [ ] **Step 2: Refactor the semantic directive into rule pairs**

Keep rubric descriptions as evaluation context. Move all enforceable behavior
out of `_SEMANTIC_DIRECTIVE` prose into a rendered rule suffix:

```python
_SEMANTIC_RULES = render_prompt_rules(
    [
        PromptRule(
            "Score every requested lever from 0 to 100 and explain it briefly without rewriting the draft.",
            "The analysis panel needs comparable findings against the existing draft.",
        ),
        PromptRule(
            "Never invent facts, statistics, brands, sources, data, or quotations.",
            FACTUAL_RATIONALE,
        ),
        PromptRule(
            "Use verbatim draft text for every passage-level `target`.",
            "The client locates and previews findings by exact-text matching.",
        ),
        PromptRule(
            "Return JSON matching the supplied semantic schema.",
            OUTPUT_RATIONALE,
        ),
    ]
)
```

Where an individual rubric item contains a real rule, keep an adjacent tailored
reason within that item. Descriptions of what a lever measures do not need a
`Because:` line.

- [ ] **Step 3: Convert every GEO generator prompt**

For each generator, form the prompt as task/context, then
`render_prompt_rules([...])`, then source text. Do not merge rules whose reasons
differ. Example for citations:

```python
rules = [
    PromptRule(
        "Add only the requested source attribution and optional supplied quotation.",
        "This is a bounded citation edit, not permission to rewrite the passage.",
    ),
    PromptRule(
        "Do not change the passage's meaning or invent information.",
        PRESERVATION_RATIONALE,
    ),
    PromptRule(
        "Preserve a supplied quotation verbatim.",
        "A changed quotation would falsely attribute words to the source.",
    ),
    PromptRule(
        "Return only the rewritten passage.",
        "The client replaces the selected passage with this response.",
    ),
]
```

Use `OUTPUT_RATIONALE` for JSON-parsed helpers, exact-splice reasons for
output-only text helpers, accessibility reasons for alt-text limits, and
factual rationales for all grounding constraints.

- [ ] **Step 4: Run the GEO milestone**

Run:

```bash
uv run pytest \
  packages/api/tests/generate/test_geo.py \
  packages/api/tests/generate/test_geo_new_levers.py -q
uv run ruff check \
  packages/api/blogforge/generate/geo.py \
  packages/api/tests/generate/test_geo.py \
  packages/api/tests/generate/test_geo_new_levers.py
```

Expected: all GEO scoring, parser, prompt, and helper tests pass.

- [ ] **Step 5: Commit the GEO family**

```bash
git add \
  packages/api/blogforge/generate/geo.py \
  packages/api/tests/generate/test_geo.py \
  packages/api/tests/generate/test_geo_new_levers.py
git commit -m "feat: explain GEO model rules"
```

---

### Task 6: Explicit source audit and release 0.8.2

**Files:**

- Create: `packages/api/tests/test_prompt_rule_inventory.py`
- Modify: any prompt source identified by the audit as missing a rationale
- Modify: focused test beside any corrected source
- Modify: `CHANGELOG.md`
- Modify through script: `packages/web/package.json`
- Modify through script: `packages/api/blogforge/__init__.py`

**Interfaces:**

- Consumes: all converted prompt families from Tasks 1–5.
- Produces: explicit source coverage and release metadata at `0.8.2`.

- [ ] **Step 1: Add the explicit inventory test**

Create `packages/api/tests/test_prompt_rule_inventory.py` with an explicit
source-to-contract map:

```python
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).parents[1] / "blogforge"

PYTHON_PROMPT_SOURCES = (
    "prompt_rules.py",
    "voice/compose.py",
    "voice/distill.py",
    "voice/enforce.py",
    "voice/fingerprint.py",
    "voice/guide.py",
    "voice/linkedin_import.py",
    "generate/builtin_formats.py",
    "generate/claims.py",
    "generate/geo.py",
    "generate/headlines.py",
    "generate/hero.py",
    "generate/humanize.py",
    "generate/ideation.py",
    "generate/inline.py",
    "generate/repurpose.py",
    "generate/suggest.py",
    "generate/topics.py",
)

STATIC_PROMPT_SOURCES = (
    "voice/assets/ai-tells/patterns.md",
    "voice/assets/humanize/lenses.md",
    "voice/assets/writing-baseline.md",
    "generate/prompts/document.j2",
    "generate/prompts/outline.j2",
    "generate/prompts/section.j2",
    "generate/prompts/section_revise.j2",
)


def test_python_prompt_sources_use_structured_rules() -> None:
    for relative in PYTHON_PROMPT_SOURCES:
        text = (ROOT / relative).read_text(encoding="utf-8")
        assert "PromptRule" in text, relative


def test_static_prompt_sources_pair_rules_and_reasons() -> None:
    for relative in STATIC_PROMPT_SOURCES:
        text = (ROOT / relative).read_text(encoding="utf-8")
        assert "Rule:" in text, relative
        assert "Because:" in text, relative
        assert text.count("Rule:") == text.count("Because:"), relative
```

Do not add `document.py`, `outline.py`, or `section.py` to the Python tuple:
they render Jinja sources and contain no independent model-rule prose.

- [ ] **Step 2: Perform the manual source audit**

Run these searches and inspect every match as either a rule already paired, or
task/context that does not require a rationale:

```bash
rg -n -i \
  '\b(do not|don.t|never|must|only|avoid|preserve|exactly|return|output|no |without)\b' \
  packages/api/blogforge/voice \
  packages/api/blogforge/generate

rg -n \
  'provider\.(complete|stream)|\.complete\(|\.stream\(' \
  packages/api/blogforge/voice \
  packages/api/blogforge/generate
```

For any missed production prompt, convert it with `PromptRule` or literal
pairs, add it to the explicit inventory, and add one focused rendered-prompt
assertion beside its existing tests.

- [ ] **Step 3: Run the complete prompt audit and API suite**

Run:

```bash
uv run pytest packages/api/tests/test_prompt_rule_inventory.py -q
uv run pytest packages/api/tests -q
uv run ruff check packages/api
scripts/version.sh check
git diff --check
```

Expected: inventory passes, the complete API suite passes, Ruff reports no
errors, versions remain synchronized at `0.8.1` before the release bump, and
Git reports no whitespace errors.

- [ ] **Step 4: Set release version and changelog**

Run:

```bash
scripts/version.sh 0.8.2
scripts/version.sh check
```

Add this release entry immediately below `## [Unreleased]` in `CHANGELOG.md`:

```markdown
## [0.8.2] — 2026-07-28

### Changed
- Every model-facing writing rule now includes an adjacent operational reason,
  improving compliance across drafting, editing, Humanize, GEO, voice
  distillation, repair, and derived-content workflows.
- Punctuation restrictions now explain that generated prose will be read by a
  text-to-speech engine and that disruptive punctuation can produce confusing
  pauses or phrasing.
```

- [ ] **Step 5: Verify the release state**

Run:

```bash
uv run pytest packages/api/tests -q
uv run ruff check packages/api
scripts/version.sh check
git diff --check
git status --short
```

Expected: the complete API suite passes again after release metadata changes,
Ruff passes, version check reports `0.8.2`, no whitespace errors appear, and
only intended tracked files plus the pre-existing untracked `.pnpm-store/`
appear.

- [ ] **Step 6: Commit the audit and release**

```bash
git add \
  packages/api/tests/test_prompt_rule_inventory.py \
  packages/api/blogforge \
  packages/api/tests \
  packages/web/package.json \
  CHANGELOG.md
git commit -m "chore: release model rule rationales"
```

- [ ] **Step 7: Inspect the final branch history**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: the branch is clean except for the pre-existing untracked
`.pnpm-store/`, and the history contains the design plus the coherent
implementation commits from this plan.
