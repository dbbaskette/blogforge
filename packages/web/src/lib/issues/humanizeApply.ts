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

/** Apply a humanize issue: swap its precomputed suggestion in for the target
 * span in the section's content_md and persist. No model call. */
export function makeHumanizeSave(draft: Draft, onSectionSave: SectionSave) {
  return async (issue: Pick<Issue, "sectionId" | "target" | "suggestion">): Promise<void> => {
    if (!issue.target || !issue.suggestion) return;
    const section = draft.sections.find((s) => s.id === issue.sectionId);
    if (!section) return;
    const next = section.content_md.replace(issue.target, issue.suggestion);
    await onSectionSave(issue.sectionId, next, true);
  };
}

/** `useIssueLifecycle`-shaped apply: ai_fix uses the precomputed suggestion,
 * manual_fix uses the writer's input, dismiss no-ops. */
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
    if (!replacement) return null;

    const before = section.content_md;
    const after = before.replace(issue.target, replacement);
    if (after === before) return null;

    await onSectionSave(issue.sectionId, after, true);
    return { sectionId: issue.sectionId, before, after, highlight: replacement, field };
  };
}
