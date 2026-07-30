# Source Material to Outline Design

**Date:** 2026-07-30  
**Status:** Approved for specification review

## Goal

Add a compose starting point for writers who have Markdown source material—a
project brief, research memo, product documentation, notes, or another
structured reference—but do not yet have a blog outline.

The feature produces an editable BlogForge outline from that material. It must
make an editorial plan for one coherent post rather than copying the supplied
Markdown headings or attempting to preserve every source section.

## User experience

The compose-mode picker gains a sixth card:

- **Icon:** 📚
- **Title:** I have source material
- **Description:** Paste a Markdown brief — AI turns it into a blog outline.

Selecting it opens a focused panel with:

1. A required working title for the intended blog post.
2. A required Markdown source-material field.
3. The same provider, model, voice, target-length, and format setup shared by
   the other compose modes.
4. A **Build outline →** action.

The panel describes the expected behavior plainly: BlogForge will use the
material as grounding, then make a new blog structure; it will not use the
Markdown headings as the finished outline.

On success, the writer lands in the existing **Outline** stage. They can edit,
reorder, regenerate, or otherwise shape the outline before they choose to
compose the article. This mode never automatically writes sections.

## What the Markdown means

The submitted Markdown is source material, not an outline and not a finished
draft.

It is persisted as a named text reference attached to the new draft. That has
three important consequences:

- The complete submitted material remains visible in the draft's reference
  list rather than becoming an opaque one-time prompt input.
- The normal reference-context path grounds outline generation, later full
  document generation, section regeneration, and fact-checking.
- The material observes the existing reference ownership, storage, prompt
  budgeting, and deletion behavior instead of introducing an incompatible
  second store for compose-time text.

The reference will use the clearly labeled name **Source material**. The
writer-facing post title comes only from the required title field; it is not
derived from a heading inside the source document.

## Outline behavior

This mode uses the existing outline-generation endpoint and returns the normal
`OutlineProposal` shape. The draft records a boolean mode flag in its
`IdeaInput` so that outline prompting knows the primary input is an editorial
brief.

When that flag is set, the outline prompt adds these requirements:

- Treat the attached source material as authoritative context for the post's
  facts, intent, and useful supporting detail.
- Decide the most useful article thesis and reader journey for the stated blog
  title and target length.
- Build a new, continuous, non-overlapping narrative outline with an opening
  hook and distinct section briefs.
- Select, combine, reframe, or leave out source details when that produces a
  stronger post.
- Do not mirror source-document headings, create one article section for every
  Markdown heading, or treat source-document order as the article structure.
- Do not invent factual claims outside the source material and any other
  attached references.

The existing outline rules remain in force: a limited number of substantive
sections, a continuous argument, a non-repeated opening, voice adherence, and
hard voice-rule constraints.

The model cannot mathematically guarantee a novel heading sequence; the
product guarantee is behavioral: the prompt gives it a distinct editorial
task, the UI describes that task honestly, and the writer retains the normal
outline-review control before prose generation.

## Frontend flow

`ComposeStudio` gains a `source` compose mode and source Markdown state. A
dedicated `SourceMaterialPanel` owns the title and Markdown inputs. It follows
the existing compose visual language and may reuse the Markdown normalization
and `.md` import behavior from `PastePanel` where doing so does not blur the
meaning of the two modes.

On **Build outline →**, the client executes this sequence under the existing
busy/error/recovery behavior:

1. Create a research-stage draft whose `IdeaInput.topic` is the working title
   and whose source-material mode flag is true.
2. Add the Markdown as a text reference named `Source material`.
3. Request the normal generated outline.
4. Save compose defaults and `source` as the most recently used mode.
5. Navigate to the created draft, which is now in the outline stage.

The source material must be persisted before the outline request. This ensures
the first model call sees it through the normal reference context rather than
being vulnerable to a later save race.

If creation succeeds but reference saving or outline generation fails,
BlogForge keeps the draft and offers the existing **Continue to your draft →**
recovery action. If saving the source reference fails, it does not request an
outline; the writer can recover, add the missing reference, and try again.

## Backend and API boundaries

No new persistence domain is required.

- Add `source_material_mode: bool = False` to the shared `IdeaInput` model and
  matching frontend `IdeaInput` type. Existing drafts remain compatible because
  the default is false.
- Reuse `POST /api/drafts` for draft creation.
- Reuse `POST /api/drafts/{draft_id}/references/text` for source persistence.
- Reuse `POST /api/drafts/{draft_id}/outline` for outline generation.
- Extend the existing outline prompt renderer with a conditional source-mode
  instruction block. The reference context remains prepended by the route in
  the existing order.

This intentionally avoids a specialized “transform Markdown into outline” API.
The separate UI mode and explicit prompt flag express the different editorial
intent, while existing draft, reference, model-resolution, permissions,
storage, and outline-validation pathways continue to own their respective
responsibilities.

## Validation and limits

- The title is required and trimmed before a draft is created.
- Source material is required and trimmed before submission.
- The reference endpoint's established text and 5 MB limits apply. The UI may
  retain the existing 1 MB local Markdown-file guard.
- Provider readiness is required exactly as it is for existing generating
  modes.
- Source Markdown is not parsed into article sections in this flow.
- `source_material_mode` is only an outline-planning hint; it does not alter
  later reference retrieval, exports, or ordinary draft editing.

## Testing

Backend tests will cover:

- `IdeaInput` defaults source-material mode to false and accepts true.
- Standard outline prompts do not include source-material-specific rules.
- Source-material outline prompts require editorial synthesis and explicitly
  prohibit mirroring source headings.
- An attached text reference is included in source-mode outline context through
  the existing reference path.

Frontend tests will cover:

- The new compose card and panel render with clear source-material language.
- Blank title or source Markdown keeps **Build outline →** disabled.
- The action creates a source-mode draft, saves the `Source material` text
  reference, then generates an outline in that order.
- Success navigates to the outline-stage draft and persists `source` as the
  last selected compose mode.
- Reference-save failure prevents outline generation and offers the existing
  recovery path.

The relevant API and web test suites, web lint/build, and existing version
checks run before completion.

## Non-goals

- No attempt to preserve Markdown headings as section headings.
- No automatic prose generation from this starting point.
- No new document parser, source-type, storage backend, or separate
  source-material editor.
- No source citation UI or automatic claims of factual verification beyond the
  existing reference-backed tools.
