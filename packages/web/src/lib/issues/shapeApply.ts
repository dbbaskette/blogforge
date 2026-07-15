/**
 * Shape's apply for the shared issue lifecycle.
 *
 * reword is a pure client-side splice (the alternatives are already written);
 * expand asks the model to grow the passage along the chosen idea, then splices.
 * Honors `persist: false` so the preview modal can show before/after without
 * writing — the same contract geoApply/humanizeApply follow.
 */

import { type Draft, inlineEdit } from "../../api/drafts";
import type { Applied } from "../../components/review/useIssueLifecycle";
import type { Issue, IssueAction } from "./types";

export interface ShapeApplyCtx {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
}

/** The section whose body contains `target`. Shape findings carry no section id. */
function sectionFor(draft: Draft, target: string): { id: string; content_md: string } | null {
  return draft.sections.find((s) => s.content_md.includes(target)) ?? null;
}

export function makeShapeApply(ctx: ShapeApplyCtx) {
  return async function apply(
    issue: Issue,
    action: IssueAction,
    input?: string,
    opts?: { persist?: boolean },
  ): Promise<Applied | null> {
    if (action !== "choose_option" && action !== "manual_fix" && action !== "write_own")
      return null;
    const chosen = input?.trim();
    if (!chosen || !issue.target) return null;

    const section = sectionFor(ctx.draft, issue.target);
    if (!section) {
      throw new Error("Couldn't find that passage — it may have been edited since the pass ran.");
    }

    // reword/manual_fix replace the passage outright; expand/write_own grow it.
    const replacement =
      issue.lever === "expand" && action === "choose_option"
        ? (
            await inlineEdit(ctx.draft.id, {
              text: issue.target,
              action: "expand",
              instruction: chosen,
            })
          ).text
        : chosen;

    const before = section.content_md;
    const after = before.replace(issue.target, replacement);

    if (opts?.persist !== false) {
      await ctx.onSectionSave(section.id, after, true);
    }
    return { sectionId: section.id, before, after, highlight: replacement, field: "content" };
  };
}
