# Review Center, Actionable Errors, and Next Actions Design

## Goal

Make the draft workspace answer three questions without forcing the writer to hunt: what needs attention, what happened when something failed, and what should happen next. This release implements GitHub issues #135, #136, and #141 as one coherent workspace hierarchy.

## Product decisions

- Replace the separate **Improve** menu and **Checkup** button with one **Review** entry point.
- Rename the Checkup overlay to **Review Center** and auto-run five checks: Proofread, Factual support, Shape, Humanization, and GEO readiness.
- Keep specialist panels as the place where findings are previewed, applied, dismissed, and undone. The Review Center is the triage layer and opens the relevant specialist panel.
- Treat Headlines and hooks as a creative follow-up in the Review Center, not as a quality check.
- Keep partial results when a check fails. Every row reports `running`, `current`, `stale`, `failed`, or `unavailable`.
- Run Factual support automatically. If the draft has no attached references, show it as unavailable with a direct explanation.
- Replace raw HTTP and JSON error strings with plain-language presentations. Preserve status, structured codes, and response details for an expandable Details disclosure.
- Show one compact **Next** card directly below the writing-stage navigation. Its primary action is derived from the draft stage and current work state.
- Remove or demote duplicate primary actions inside Outline and Draft panels so the Next card owns progression.

## Review Center behavior

The Review Center uses editorial priority, not API order:

1. Proofread
2. Factual support
3. Shape
4. Humanization
5. GEO readiness

Opening the Review Center for the first time runs all five checks in parallel. Existing compatible cached results are reused for paid analyses. The combined summary is cached against the draft content hash. Reopening unchanged content is instant. Edited content retains the prior summary but marks completed rows stale until the writer chooses **Re-run**.

Failures are isolated per row. A provider failure in Humanization must not hide a successful Proofread result. A failed row uses the shared error presenter and the header offers **Retry failed checks** or **Re-run**, depending on state. A row can open its specialist panel and, when the result identifies a section, move the editor to that section.

Factual support counts unsupported and contradicted claims as open concerns. A no-reference result is not a failure; it is unavailable and says to attach references before checking support.

## Error presentation model

The API client parses error bodies into an `ApiError` that carries:

- a safe message with no `HTTP 422: {...}` prefix;
- HTTP status;
- stable error code when supplied;
- raw detail for the optional technical disclosure;
- existing publishing metadata such as repository URL and path.

`presentError(error, operation)` maps known classes into a title, explanation, preservation statement, and recommended action. Required cases are validation, provider setup/rejection, stale/conflict, expired session, service failure, and unknown failure. UI surfaces use a reusable `ErrorNotice` for retry, settings, sign-in, reload, dismiss, and Details actions.

No new user-facing copy in this release uses an em dash.

## Next-action states

The pure `deriveNextDraftAction` model returns one of these actions:

| State | Primary action |
| --- | --- |
| Research, setup ready | Create outline |
| Research, missing model | Create outline, disabled; link to Setup |
| Outline with sections | Compose draft |
| Outline with no sections | Compose draft, disabled; explain blocker |
| Draft generation active | Writing draft, disabled; show progress |
| Draft generation failed with unwritten sections | Retry remaining sections |
| Draft with unwritten sections | Finish remaining sections |
| Complete draft whose outline drifted | Review outline |
| Complete current draft | Review draft |

The card is an editorial margin note: a cobalt left rule, a small `NEXT` label, concise supporting copy, and one strong button. It uses BlogForge's existing type, spacing, and color tokens. No new global palette or typefaces are introduced. On mobile it stacks without covering the workspace footer.

## Accessibility and responsive behavior

- Review Center remains a labelled modal side panel with focus trapping and Escape-to-close.
- Status is conveyed with text as well as color.
- Every next action has an explicit accessible name and disabled controls include a visible blocker.
- Details disclosures use native `details` and `summary` elements.
- Review rows and footer controls remain usable at narrow widths.

## Validation

- Unit tests cover review summarization, facts with and without references, partial failures, stale cache conversion, and next-action derivation.
- Component tests cover the single Review footer entry point, Review Center partial results, and action callbacks.
- API/error tests cover validation, provider, conflict, session, and unknown responses without exposing raw JSON as the primary message.
- The complete frontend suite, lint, TypeScript build, version checks, and relevant project tests must pass.
