# Draft Length Variations Design

## Goal

Let an author turn a completed draft into a summarized version, an extended
version, or a LinkedIn feed post, inspect the generated result, and explicitly
save it as a separate editable draft without changing the source.

## Scope

The existing Repurpose panel is the entry point. It gains two formats and a
save action:

- **Summarized version:** target 50% of the source word count.
- **Extended version:** target 150% of the source word count.
- **LinkedIn post:** update the existing format to target 1,300–1,600
  characters, roughly 200–300 words, while retaining LinkedIn's 3,000-character
  platform maximum as contextual guidance rather than the selected target.

The existing X thread, LinkedIn article, newsletter, TL;DR, meta description,
email, and atomize-all behavior remain available. Saving as a draft is offered
for the three length-controlled formats only. The source draft is never
modified.

## User Flow

1. The author opens Repurpose from a draft that contains written sections.
2. They select Summarized version, Extended version, or LinkedIn post.
3. BlogForge generates a voice-aware preview from the assembled source draft.
4. The preview shows the measured length and the requested range.
5. If the result remains outside the range after the automatic correction
   attempt, the preview displays a warning but remains copyable and saveable.
6. The author selects **Save as new draft**.
7. BlogForge creates a normal sections-stage draft and opens it in the editor.

The new draft title is derived from the source:

- `<Original Title> — Summary`
- `<Original Title> — Extended`
- `<Original Title> — LinkedIn Post`

The new draft copies the source draft's provider, model, voice settings, format
selection, and tags. It does not copy publication metadata, hero imagery,
ideation history, or reference attachments. The generated variation already
uses the source article as its factual boundary, and excluding attachments
avoids duplicating stored reference assets in this focused change.

## Generation and Length Enforcement

The repurpose generator remains the single voice-aware generation path. The
format catalog adds `summary` and `extended`; `linkedin` receives the revised
character-based rule.

The server assembles the source Markdown once and calculates targets before
calling the provider:

- Summary target: `round(source_words * 0.50)`.
- Extended target: `round(source_words * 1.50)`.
- Relative-format accepted range: target ±10%, rounded to whole words, with a
  minimum lower bound of one word.
- LinkedIn accepted range: exactly 1,300–1,600 Unicode characters, including
  whitespace and line breaks.

The initial prompt includes the concrete calculated target range rather than
only a general instruction. After generation, the server measures the response.
When it falls outside the range, the server makes one additional provider call
that includes the prior result, its measured length, and the same target range.
The correction prompt requires preserving facts and voice while changing only
what is necessary to reach the range.

After at most two calls, the API returns the text plus structured length
metadata:

- metric: `words` or `characters`
- actual measured length
- minimum and maximum accepted values
- whether the result is within the accepted range
- whether a correction was attempted

An out-of-range second result is not treated as an API failure. The user can
judge, copy, or save it, and the UI makes the miss visible.

Existing formats keep their current prompt constraints and continue to return
without the new validation retry.

## Saving a Preview

A dedicated authenticated endpoint saves a generated preview as a variation of
the source draft. Its request contains:

- variation type: `summary`, `extended`, or `linkedin`
- the preview text returned by generation

The endpoint:

1. Confirms the source draft exists and belongs to the current user.
2. Rejects blank preview text.
3. Builds the suffix title from the authoritative source title and variation
   type.
4. Copies the source `IdeaInput`, replacing its topic with the new title and
   setting `target_words` to the generated preview's word count clamped to the
   model's existing 300–10,000-word limits.
5. Parses the generated Markdown through the existing document-ingestion
   helper, prefixed with the authoritative H1 title, so headings become normal
   editable sections without losing prose.
6. Creates and persists a new sections-stage draft with copied tags.
7. Emits the existing `draft:created` event and returns the complete new draft.

The preview text is intentionally accepted from the browser because saving is
an explicit second step and future inline preview editing should not require
regeneration. All title and source metadata remain server-authoritative.

Creation is performed entirely on the server. A failed save leaves the source
and preview untouched, allowing the author to retry.

## Frontend Behavior

`RepurposePanel` continues to own generation state. For a selected
length-controlled result it adds:

- an actual-versus-target length line;
- an out-of-range warning when applicable;
- a **Save as new draft** button;
- a saving state that prevents duplicate submissions;
- a save error displayed next to the preview.

On success, the panel navigates directly to `/drafts/<new-id>`. Copy remains
available independently of save.

Atomize all continues generating every format. To keep its batch interface
focused and avoid multiple accidental draft creations, save buttons are shown
only after an author selects and generates one of the three length-controlled
formats individually.

## Error Handling

- Missing or inaccessible source draft: existing 404 response.
- Source has no written content: existing 409 response.
- Provider or voice composition failure: existing repurpose error response.
- Blank save body: 422 validation response.
- Unsupported save variation: 422 validation response.
- First result out of range: retry once automatically.
- Second result out of range: return the result with `within_target: false`.
- Save failure: keep the preview visible and show the error; do not navigate.

## Testing

Backend generator tests cover:

- summary and extended prompt targets calculated from source length;
- LinkedIn prompt guidance using 1,300–1,600 characters;
- in-range results completing after one provider call;
- out-of-range results causing exactly one correction call;
- second out-of-range results returning warning metadata rather than failing;
- word and character measurement boundaries.

Backend route tests cover:

- saving each supported variation as a separate sections-stage draft;
- title suffix, copied tags, and copied provider/voice settings;
- source draft remaining unchanged;
- user ownership isolation;
- blank and unsupported save requests.

Frontend tests cover:

- the three requested choices appearing in Repurpose;
- actual and target lengths rendering on a preview;
- warning rendering for a remaining miss;
- Save as new draft calling the save API and navigating to the returned draft;
- save failure preserving the preview.

The full API and web test suites run before completion.
