# Model-facing rule rationales

**Date:** 2026-07-28

## Goal

Every explicit rule sent to a language model must state both the required
behavior and why that behavior matters. BlogForge will use the consistent
form:

```text
Rule: Do not use em dashes.
Because: This text will be read by a text-to-speech engine, and em dashes can
produce confusing pauses or phrasing.
```

The rationale is part of the model instruction, not user-facing explanatory
copy. The intent is to improve model compliance by giving each constraint a
clear purpose.

## Scope

A **model-facing rule** is an explicit constraint in text sent to an LLM. This
includes:

- prohibitions such as “do not invent sources” or “never use em dashes”;
- preservation requirements such as retaining facts, links, quotations,
  meaning, structure, or author voice;
- output contracts such as returning only JSON, Markdown, a rewritten passage,
  or a requested schema;
- continuity and structure requirements such as not repeating earlier
  sections;
- style and humanization constraints; and
- mechanical repair instructions.

Task descriptions, source material, examples, section briefs, contextual facts,
and explanatory comments that are not sent to a model are not rules and do not
need `Because` text.

The change covers all production prompt sources under:

- `packages/api/blogforge/voice/`;
- `packages/api/blogforge/generate/`; and
- `packages/api/blogforge/generate/prompts/`.

It includes Python-built prompts, Jinja templates, bundled Markdown prompt
assets, portable voice-guide instructions, and post-generation repair prompts.
There is no database or frontend schema change.

## Rule format

Each explicit constraint will be rendered as a paired instruction and
rationale:

```text
Rule: <specific required or prohibited behavior>
Because: <specific operational reason>
```

Lists may use compact paired bullets when that is clearer:

```text
- Rule: Preserve every number, name, quotation, and link.
  Because: Humanization must not alter the article's factual record.
```

A rationale belongs directly beside its rule. One generic paragraph at the end
of a prompt does not satisfy the requirement because the model may not associate
it with each individual constraint.

Compound instructions that contain multiple independently testable constraints
will be split into separate `Rule` / `Because` pairs. This keeps each reason
unambiguous and makes prompt tests precise.

Examples may follow the rationale, but examples do not replace it.

The `Rule` and `Because` labels are prompt metadata, not article prose. Prompts
will tell the model to follow the rules without copying either label into its
output when that distinction could otherwise be ambiguous.

## Rationale categories

Rationales must be tailored to the rule instead of repeating one generic reason.
The implementation will use these defaults:

### Punctuation and pronounceability

Rules about em dashes, en dashes, ASCII double hyphens, or other disruptive
punctuation use the text-to-speech rationale:

> Because: This text will be read by a text-to-speech engine, and this
> punctuation can produce confusing pauses or phrasing.

### Factual integrity

Rules against inventing facts, quotations, statistics, dates, or sources explain
that unsupported material damages factual trust and attribution.

### Preservation

Rules that preserve meaning, facts, links, quotations, structure, or author
voice explain that the operation is a bounded edit and must not damage the
approved article.

### Machine-readable output

Rules requiring JSON, Markdown, exact fields, verbatim targets, or output-only
responses explain that downstream code parses the response and extra or malformed
content breaks the workflow.

### Article continuity

Rules against repeated hooks, duplicated points, recycled examples, restarts,
or reordered sections explain that the sections form one continuous article.

### Human voice and style

Anti-AI-tell, rhythm, vocabulary, and humanization rules explain the observable
writing defect they prevent: templated rhythm, vague claims, inflated language,
false polish, or loss of the author's voice.

### Product-specific formats

Channel limits and formatting rules for LinkedIn, excerpts, headlines, FAQs,
tables, alt text, and similar outputs explain the consuming surface or reader
behavior that makes the constraint necessary.

## Architecture

### Structured rules in Python prompts

Add a small prompt-rule utility with a required instruction and rationale:

```python
@dataclass(frozen=True)
class PromptRule:
    instruction: str
    rationale: str

    def __post_init__(self) -> None:
        ...


def render_prompt_rules(rules: Sequence[PromptRule]) -> str:
    ...
```

Both values are required and `__post_init__` rejects blank or whitespace-only
values. Python prompt builders will use this utility for explicit constraint
blocks. This makes omission of a rationale harder when future Python-built
rules are added.

The utility only renders rules. It does not own task text, examples, source
context, or response schemas.

### Templates and Markdown assets

Jinja templates and bundled Markdown prompt assets cannot naturally share the
Python data structure without making them harder to read. They will use the same
literal `Rule` / `Because` convention in place.

The primary assets include:

- the voice humanizer and writing baseline;
- AI-tell patterns;
- humanization lenses;
- document, outline, section, and section-revision templates; and
- specialized prompts for inline edits, GEO, claims, ideation, headlines,
  repurposing, suggestions, topics, hero prompts, distillation, fingerprinting,
  and repair.

### Existing user rules

User-entered banished words and phrases remain plain data. The prompt groups them
under a rule with one rationale:

```text
Rule: Do not use any item in this banished vocabulary list: ...
Because: These terms conflict with the author's established voice and explicit
preferences.
```

The system will not invent a separate explanation for every individual word.
Permitted exceptions retain their existing user-supplied reasons.

## Data flow

1. A generation or editing workflow assembles its task and context.
2. Explicit constraints are rendered as adjacent `Rule` / `Because` pairs.
3. The finished prompt is sent through the existing provider interface.
4. Existing deterministic validation and post-generation enforcement continue
   unchanged.
5. If repair is required, the repair prompt also explains every rule it asks the
   model to correct.

Rationales do not replace deterministic safeguards. They improve first-pass and
repair-pass compliance while linting, source checks, schema parsing, and
mechanical punctuation backstops remain authoritative.

## Error handling

- `PromptRule` rejects blank instructions or rationales during construction or
  rendering, with construction validation as the primary guard.
- A missing rationale in a Python prompt is a programming error surfaced by
  tests, not silently replaced with generic text.
- Static template and asset coverage is enforced by an explicit prompt-source
  inventory test.
- Existing provider, parsing, and generation error behavior is unchanged.

## Testing

### Unit tests

- Render one and multiple `PromptRule` values with adjacent `Rule` and `Because`
  text.
- Reject a blank instruction or rationale.
- Verify punctuation rules use the text-to-speech rationale.
- Verify factual, preservation, output-contract, continuity, and style rules use
  appropriate tailored rationales.

### Prompt tests

Update existing prompt snapshots/assertions and add focused checks for:

- voice composition and portable voice guides;
- post-generation repair;
- document, outline, section, and revision prompts;
- humanize and inline-edit prompts;
- GEO and claims prompts; and
- specialized headline, repurpose, suggestion, topic, hero, and distillation
  prompts.

### Inventory audit

Maintain an explicit list of production prompt source files. The audit test
asserts each listed source has been reviewed and that its explicit constraint
blocks follow the `Rule` / `Because` convention. The inventory is intentionally
explicit rather than a fragile natural-language regex over the whole codebase.
All current prompt sources will be manually converted during implementation;
future Python rules gain structural enforcement through `PromptRule`, while
focused tests protect rules that remain in Jinja and Markdown.

### Completion gate

Run focused prompt tests after coherent prompt families are converted. Run the
complete API suite once before completion, following the repository testing
cadence. Frontend tests are unnecessary unless implementation changes frontend
code.

## Release

This is a user-visible model-behavior change. Increment BlogForge's patch
version from `0.8.1` to `0.8.2`, update the changelog, and document that
model-facing rules now carry reasons to improve compliance.

## Out of scope

- New user-editable rationale fields;
- database or API migrations;
- changing the deterministic linter or punctuation backstop;
- redesigning the Voice or Help UI;
- modifying comments, documentation, or validation rules that are never sent to
  an LLM; and
- measuring causal improvement in model compliance as part of this release.
