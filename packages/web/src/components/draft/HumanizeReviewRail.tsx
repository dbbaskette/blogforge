/**
 * The Humanize panel's findings list, rendered on the shared issue-card model —
 * the same IssueCard + useIssueLifecycle machine GEO and the Proofreader use,
 * grouped by lens the way GEO groups by lever.
 *
 * Humanize findings arrive with their rewrite precomputed (see humanizeApply.ts
 * — ai_fix needs no model call); everything else, including dismissal, is the
 * shared rail's.
 */

import { useMemo } from "react";

import type { Draft } from "../../api/drafts";
import type { HumanizeReport } from "../../api/humanize";
import { humanizeFindingsToIssues } from "../../lib/issues/humanizeAdapter";
import { makeHumanizeApply } from "../../lib/issues/humanizeApply";
import { type ReviewGroup, ReviewRail } from "../review/ReviewRail";

export interface HumanizeReviewRailProps {
  report: HumanizeReport;
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onHighlight?: (sectionId: string, text: string | null, kind: "under-review" | "locate") => void;
}

export function HumanizeReviewRail({
  report,
  draft,
  onSectionSave,
  onHighlight,
}: HumanizeReviewRailProps): JSX.Element {
  const issues = useMemo(() => humanizeFindingsToIssues(report), [report]);
  const apply = useMemo(() => makeHumanizeApply(draft, onSectionSave), [draft, onSectionSave]);
  // Every Humanize finding targets body text, so a passthrough save is enough —
  // but it must createVersion so a previewed fix is still a versioned edit.
  const save = useMemo(
    () => (sectionId: string, content: string) => onSectionSave(sectionId, content, true),
    [onSectionSave],
  );
  const groups = useMemo<ReviewGroup[]>(
    () => report.lenses.map((lens) => ({ key: lens.key, label: lens.label })),
    [report.lenses],
  );

  return (
    <ReviewRail
      issues={issues}
      groups={groups}
      draftId={draft.id}
      apply={apply}
      save={save}
      onHighlight={onHighlight}
      groupLabelFor={(key) => report.lenses.find((l) => l.key === key)?.label ?? key}
      emptyState={
        <p className="py-8 text-center text-sm text-muted">
          No robotic tells found — this already reads human.
        </p>
      }
    />
  );
}
