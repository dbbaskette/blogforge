/**
 * The Humanize panel's apply functions. Unlike GEO/Proofreader, every finding
 * already carries its rewrite (the backend's `suggestion`), so applying one is
 * a client-side splice — no model call.
 *
 * `makeHumanizeSave` is the plain target->suggestion save used directly by
 * simpler callers/tests. `makeHumanizeApply` wraps the same substitution in
 * the `(issue, action, input?) => Promise<Applied | null>` shape
 * `useIssueLifecycle`'s `apply` prop expects (mirrors `makeGeoApply` /
 * `makeProofreadApply` in `components/draft/`), so a manual fix can still
 * override the suggestion with the writer's own text.
 */

import type { Draft } from "../../api/drafts";
import type { Applied, AppliedField } from "../../components/review/useIssueLifecycle";
import type { Issue, IssueAction } from "./types";

type SectionSave = (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;

/**
 * Locate `target` in `text` for a *safe* replacement — exact first, then a
 * whitespace-tolerant full match (source markdown often reflows a run across
 * newlines that the model's target joined with single spaces). Deliberately NO
 * fuzzy/prefix fallback: replacing the wrong or partial span would corrupt the
 * draft, so anything less than a confident full match returns null and the
 * caller surfaces "re-analyze" instead of guessing.
 */
export function locateForReplace(text: string, target: string): [number, number] | null {
  const exact = text.indexOf(target);
  if (exact >= 0) return [exact, exact + target.length];
  const pattern = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  try {
    const m = new RegExp(pattern).exec(text);
    if (m) return [m.index, m.index + m[0].length];
  } catch {
    /* malformed pattern — fall through to "not found" */
  }
  return null;
}

/** The message shown when a finding's target can no longer be located — almost
 *  always because the draft changed after the pass was run (a regenerate, an
 *  edit, or a sibling fix). */
const STALE_TARGET_MESSAGE =
  "This passage has changed since the pass ran — re-analyze to refresh it, or use Manual fix.";

/** Apply a humanize issue: swap its precomputed suggestion in for the target
 * span in the section's content_md and persist. No model call. Throws (rather
 * than silently doing nothing) when the target can't be located. */
export function makeHumanizeSave(draft: Draft, onSectionSave: SectionSave) {
  return async (issue: Pick<Issue, "sectionId" | "target" | "suggestion">): Promise<void> => {
    if (!issue.target || !issue.suggestion) return;
    const section = draft.sections.find((s) => s.id === issue.sectionId);
    if (!section) return;
    const span = locateForReplace(section.content_md, issue.target);
    if (!span) throw new Error(STALE_TARGET_MESSAGE);
    const next =
      section.content_md.slice(0, span[0]) + issue.suggestion + section.content_md.slice(span[1]);
    await onSectionSave(issue.sectionId, next, true);
  };
}

/** `useIssueLifecycle`-shaped apply: ai_fix uses the precomputed suggestion,
 * manual_fix uses the writer's input, dismiss no-ops.
 *
 * Returns `null` ONLY for benign no-ops (dismiss handled above, cancelled/empty
 * manual input). A genuine failure — the target text is no longer present, so
 * there is nothing to replace — THROWS, so the lifecycle surfaces it instead of
 * leaving the writer staring at a button that silently did nothing. */
export function makeHumanizeApply(
  draft: Draft,
  onSectionSave: SectionSave,
): (issue: Issue, action: IssueAction, input?: string) => Promise<Applied | null> {
  const field: AppliedField = "content";
  return async (issue, action, input) => {
    if (action === "dismiss") return { sectionId: issue.sectionId, before: "", after: "", field };

    const section = draft.sections.find((s) => s.id === issue.sectionId);
    if (!section || !issue.target) return null;

    const replacement = action === "manual_fix" ? input : issue.suggestion;
    if (!replacement) return null; // cancelled/empty manual input — benign no-op

    const before = section.content_md;
    const span = locateForReplace(before, issue.target);
    if (!span) throw new Error(STALE_TARGET_MESSAGE);
    const after = before.slice(0, span[0]) + replacement + before.slice(span[1]);
    if (after === before) throw new Error("The suggestion already matches the current text.");

    await onSectionSave(issue.sectionId, after, true);
    return { sectionId: issue.sectionId, before, after, highlight: replacement, field };
  };
}
