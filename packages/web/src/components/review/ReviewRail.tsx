/**
 * The one findings list every review panel renders.
 *
 * Owns grouping, dismissal (+ the show-dismissed toggle), the busy overlay, the
 * fix-preview modal, the empty state, and the `why` dedupe rule. Panels keep
 * their own headers and supply issues + groups + apply/save, so the suggestion
 * list and the fix flow can't drift between GEO, Proofread, Humanize and Shape.
 */

import { type ReactNode, useMemo, useState } from "react";

import { dismiss as dismissIssue, loadDismissed, restore } from "../../lib/issues/dismissals";
import type { Issue, IssueAction } from "../../lib/issues/types";
import { BusyOverlay } from "../ui/BusyOverlay";
import { FixPreviewModal } from "./FixPreviewModal";
import { IssueCard } from "./IssueCard";
import { reviewBusyLabel } from "./reviewBusyLabel";
import { type UseIssueLifecycleArgs, useIssueLifecycle } from "./useIssueLifecycle";

export interface ReviewGroup {
  key: string;
  label: string;
  /** Group-level prose. Shown under the header and used as the why-dedupe basis. */
  detail?: string;
  /** Pluggable header content (GEO's score bar, Humanize's lens label). */
  header?: ReactNode;
}

export interface ReviewRailProps {
  issues: Issue[];
  /** Render order; groups with no issues are skipped. */
  groups: ReviewGroup[];
  draftId: string;
  apply: UseIssueLifecycleArgs["apply"];
  save: UseIssueLifecycleArgs["save"];
  onHighlight?: UseIssueLifecycleArgs["onHighlight"];
  onApplied?: UseIssueLifecycleArgs["onApplied"];
  onRescore?: (lever: string) => void;
  onRestoreLever?: (lever: string) => void;
  emptyState: ReactNode;
  /** Panel-level affordance above the list (GEO's "How these rules work →"). */
  headerSlot?: ReactNode;
  actionLabels?: Partial<Record<IssueAction, string>>;
  /** Resolve a group's display label for the preview modal. */
  groupLabelFor?: (lever: string) => string;
}

const norm = (s: string): string => s.trim().toLowerCase();

export function ReviewRail({
  issues,
  groups,
  draftId,
  apply,
  save,
  onHighlight,
  onApplied,
  onRescore,
  onRestoreLever,
  emptyState,
  headerSlot,
  actionLabels,
  groupLabelFor,
}: ReviewRailProps): JSX.Element {
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed(draftId));
  const [showDismissed, setShowDismissed] = useState(false);

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
    draftId,
    apply,
    save,
    onHighlight,
    onApplied,
    onRescore,
    onUndoRescore: onRestoreLever,
  });
  const busyLabel = reviewBusyLabel(busyAction);

  const visible = useMemo(() => issues.filter((i) => !dismissed.has(i.id)), [issues, dismissed]);
  const hidden = useMemo(() => issues.filter((i) => dismissed.has(i.id)), [issues, dismissed]);

  const byGroup = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const i of visible) {
      const list = map.get(i.lever) ?? [];
      list.push(i);
      map.set(i.lever, list);
    }
    return map;
  }, [visible]);

  const handleAction = (issue: Issue, action: IssueAction, input?: string): void => {
    if (action === "dismiss") {
      setDismissed(dismissIssue(draftId, issue.id));
      return;
    }
    if (action === "ai_fix" || action === "choose_option") {
      void requestPreview(issue, action, input);
      return;
    }
    void run(issue, action, input);
  };

  /** Show a why only when it isn't already on screen — as the card's own title,
   *  or as the group's detail line. Data-driven, so no panel can opt out. */
  const resolveWhy = (issue: Issue, detail?: string): string => {
    const why = issue.why ?? "";
    if (!why) return "";
    if (norm(why) === norm(issue.title)) return "";
    if (detail && norm(why) === norm(detail)) return "";
    return why;
  };

  return (
    <div className="space-y-4">
      {busyLabel && <BusyOverlay label={busyLabel} />}
      {headerSlot}

      {visible.length === 0 ? (
        <>{emptyState}</>
      ) : (
        groups.map((group) => {
          const groupIssues = byGroup.get(group.key) ?? [];
          if (groupIssues.length === 0) return null;
          return (
            <section key={group.key} className="glass-card p-3 space-y-2">
              {group.header ?? <h3 className="text-sm font-semibold text-ink">{group.label}</h3>}
              {group.detail && <p className="text-xs text-muted leading-snug">{group.detail}</p>}
              <div className="space-y-2">
                {groupIssues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={{
                      ...issue,
                      status: statusOf(issue),
                      why: resolveWhy(issue, group.detail),
                    }}
                    busy={busyId === issue.id}
                    error={errorOf(issue)}
                    actionLabels={actionLabels}
                    onAction={(action, input) => handleAction(issue, action, input)}
                    onAccept={() => accept(issue)}
                    onUndo={() => void undo(issue)}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {hidden.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowDismissed((v) => !v)}
            className="text-xs font-medium text-muted hover:text-ink underline underline-offset-2"
          >
            {showDismissed ? "Hide" : "Show"} dismissed ({hidden.length})
          </button>
          {showDismissed && (
            <ul className="mt-2 space-y-1.5">
              {hidden.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-xs text-muted">
                  <span className="truncate flex-1">{i.title}</span>
                  <button
                    type="button"
                    onClick={() => setDismissed(restore(draftId, i.id))}
                    className="text-cobalt-600 hover:text-cobalt-700 shrink-0"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview && (
        <FixPreviewModal
          title={preview.issue.title}
          leverLabel={groupLabelFor?.(preview.issue.lever) ?? preview.issue.lever}
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
