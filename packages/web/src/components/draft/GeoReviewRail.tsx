/**
 * The GEO panel's findings list, rendered on the unified issue-card model.
 * Every finding becomes an Issue (geoFindingsToIssues) and flows through the
 * shared IssueCard + useIssueLifecycle state machine (open → review → accepted,
 * with per-issue undo) — the same components the Proofreader uses, so the two
 * panels can't drift apart again. The per-lever score bars are preserved; each
 * lever heads its group of cards.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";

import type { Draft } from "../../api/drafts";
import type { GeoReport } from "../../api/geo";
import { geoFindingsToIssues } from "../../lib/issues/geoAdapter";
import { fillSectionIds } from "../../lib/issues/locateSection";
import { FixPreviewModal } from "../review/FixPreviewModal";
import { IssueCard } from "../review/IssueCard";
import { reviewBusyLabel } from "../review/reviewBusyLabel";
import { useIssueLifecycle } from "../review/useIssueLifecycle";
import { BusyOverlay } from "../ui/BusyOverlay";
import { makeGeoApply, makeGeoSave } from "./geoApply";

function barColor(score: number): string {
  if (score >= 72) return "#15a06b";
  if (score >= 58) return "#f59e0b";
  return "#e6492d";
}

export interface GeoReviewRailProps {
  report: GeoReport;
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onOpeningSave: (next: string) => Promise<void>;
  onTitleSave: (sectionId: string, title: string) => Promise<void>;
  onRescore?: (lever: string) => void;
  /** Undo restores the pre-fix lever score instantly (no model re-run). */
  onRestoreLever?: (lever: string) => void;
  onHighlight?: (sectionId: string, text: string | null, kind: "under-review" | "locate") => void;
  /** Lever keys whose targeted re-score is in flight — the header shows an
   * "updating" pill on those while the rest of the card stays interactive. */
  inFlight?: Set<string>;
}

export function GeoReviewRail({
  report,
  draft,
  onSectionSave,
  onOpeningSave,
  onTitleSave,
  onRescore,
  onRestoreLever,
  onHighlight,
  inFlight,
}: GeoReviewRailProps): JSX.Element {
  // Resolve each finding's section up front (many backend findings tag a target
  // but no section_id) so highlight, apply, and undo all act on the same place.
  const issues = useMemo(
    () => fillSectionIds(geoFindingsToIssues(report), draft.sections),
    [report, draft.sections],
  );
  const ctx = useMemo(
    () => ({ draft, onSectionSave, onOpeningSave, onTitleSave }),
    [draft, onSectionSave, onOpeningSave, onTitleSave],
  );
  const apply = useMemo(() => makeGeoApply(ctx), [ctx]);
  const save = useMemo(() => makeGeoSave(ctx), [ctx]);
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
    onRescore,
    onUndoRescore: onRestoreLever,
  });
  const busyLabel = reviewBusyLabel(busyAction);
  const leverLabelFor = (key: string): string =>
    report.levers.find((l) => l.key === key)?.label ?? key;

  const byLever = useMemo(() => {
    const map = new Map<string, typeof issues>();
    for (const issue of issues) {
      const list = map.get(issue.lever) ?? [];
      list.push(issue);
      map.set(issue.lever, list);
    }
    return map;
  }, [issues]);

  return (
    <div className="space-y-4">
      {busyLabel && <BusyOverlay label={busyLabel} />}
      <div className="flex items-center justify-end">
        <Link
          to="/help#geo"
          className="text-xs text-muted underline underline-offset-2 hover:text-ink"
        >
          How these rules work →
        </Link>
      </div>
      {report.levers.map((lever) => {
        const leverIssues = byLever.get(lever.key) ?? [];
        if (leverIssues.length === 0) return null;
        return (
          <section key={lever.key} className="glass-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">
                {lever.label}
                <span className="text-[11px] text-muted-2 font-normal ml-2">
                  up to {Math.round((lever.weight ?? 0) * 100)} pts
                </span>
              </h3>
              {inFlight?.has(lever.key) ? (
                <span className="text-[11px] text-cobalt-700 font-medium animate-pulse tabular-nums">
                  updating…
                </span>
              ) : (
                <span
                  className="text-xs font-mono tabular-nums"
                  style={{ color: barColor(lever.score) }}
                >
                  {lever.score}
                </span>
              )}
            </div>
            <div className="h-1.5 w-full rounded-full bg-rule/60 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${lever.score}%`, background: barColor(lever.score) }}
              />
            </div>
            <p className="text-xs text-muted leading-snug">{lever.detail}</p>

            <div className="space-y-2">
              {leverIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={{ ...issue, status: statusOf(issue) }}
                  busy={busyId === issue.id}
                  error={errorOf(issue)}
                  showWhy={false}
                  onAction={(action, inputText) =>
                    action === "ai_fix"
                      ? void requestPreview(issue, action, inputText)
                      : void run(issue, action, inputText)
                  }
                  onAccept={() => accept(issue)}
                  onUndo={() => void undo(issue)}
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
