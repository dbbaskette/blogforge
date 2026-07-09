/**
 * The Humanize panel's findings list, rendered on the shared issue-card model —
 * the same IssueCard + useIssueLifecycle machine GEO and the Proofreader use,
 * grouped by lens the way GEO groups by lever.
 *
 * Two things differ from GEO/Proofread: every finding already carries its
 * rewrite (see humanizeApply.ts — ai_fix needs no model call), and Dismiss
 * persists to humanizeDismissals instead of just flipping the card green, so a
 * dismissed finding stays gone the next time the panel opens (re-analysis
 * would otherwise resurface it every time).
 */

import { useMemo, useState } from "react";

import type { Draft } from "../../api/drafts";
import type { HumanizeReport } from "../../api/humanize";
import { dismiss as dismissFinding, loadDismissed } from "../../lib/humanizeDismissals";
import { humanizeFindingsToIssues } from "../../lib/issues/humanizeAdapter";
import { makeHumanizeApply } from "../../lib/issues/humanizeApply";
import type { Issue, IssueAction } from "../../lib/issues/types";
import { FixPreviewModal } from "../review/FixPreviewModal";
import { IssueCard } from "../review/IssueCard";
import { reviewBusyLabel } from "../review/reviewBusyLabel";
import { useIssueLifecycle } from "../review/useIssueLifecycle";
import { BusyOverlay } from "../ui/BusyOverlay";

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
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadDismissed(draft.id));

  const issues = useMemo(
    () => humanizeFindingsToIssues(report).filter((issue) => !dismissedIds.has(issue.id)),
    [report, dismissedIds],
  );
  const apply = useMemo(() => makeHumanizeApply(draft, onSectionSave), [draft, onSectionSave]);
  // The lifecycle's save persists two things: the confirmed AI fix (from the
  // preview modal) and an undo restore. Both are body-text writes (every
  // Humanize finding targets content, never a title/opening), so a plain
  // passthrough is enough — but it must createVersion, mirroring the old
  // direct-apply path (makeHumanizeApply saved with createVersion=true) so a
  // previewed fix is still a versioned edit.
  const save = useMemo(
    () => (sectionId: string, content: string) => onSectionSave(sectionId, content, true),
    [onSectionSave],
  );
  const {
    statusOf,
    errorOf,
    busyId,
    busyAction,
    run,
    accept,
    undo,
    preview,
    requestPreview,
    confirmPreview,
    cancelPreview,
  } = useIssueLifecycle({
    draftId: draft.id,
    apply,
    save,
    onHighlight,
  });
  const busyLabel = reviewBusyLabel(busyAction);

  const handleAction = (issue: Issue, action: IssueAction, input?: string): void => {
    if (action === "dismiss") {
      setDismissedIds(dismissFinding(draft.id, issue.id));
      return;
    }
    if (action === "ai_fix") {
      void requestPreview(issue, action, input);
      return;
    }
    void run(issue, action, input);
  };

  const leverLabelFor = (key: string): string =>
    report.lenses.find((l) => l.key === key)?.label ?? key;

  const byLens = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      const list = map.get(issue.lever) ?? [];
      list.push(issue);
      map.set(issue.lever, list);
    }
    return map;
  }, [issues]);

  if (issues.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        No robotic tells found — this already reads human.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {busyLabel && <BusyOverlay label={busyLabel} />}
      {report.lenses.map((lens) => {
        const lensIssues = byLens.get(lens.key) ?? [];
        if (lensIssues.length === 0) return null;
        return (
          <section key={lens.key} className="glass-card p-3 space-y-2">
            <h3 className="text-sm font-semibold text-ink">{lens.label}</h3>
            <div className="space-y-2">
              {lensIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={{ ...issue, status: statusOf(issue) }}
                  busy={busyId === issue.id}
                  error={errorOf(issue)}
                  onAction={(action, inputText) => handleAction(issue, action, inputText)}
                  onAccept={() => accept(issue)}
                  onUndo={() => void undo(issue)}
                  actionLabels={{ highlight: "Jump to" }}
                />
              ))}
            </div>
          </section>
        );
      })}
      {preview && (
        <FixPreviewModal
          title={preview.issue.title}
          leverLabel={leverLabelFor(preview.issue.lever)}
          why={preview.issue.why}
          before={preview.res.before}
          after={preview.res.after}
          busy={busyId === preview.issue.id}
          onApply={(finalAfter) => void confirmPreview(finalAfter)}
          onCancel={cancelPreview}
        />
      )}
    </div>
  );
}
