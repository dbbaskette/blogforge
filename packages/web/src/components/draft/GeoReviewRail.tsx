/**
 * The GEO panel's findings list, rendered through the shared ReviewRail.
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
import { type ReviewGroup, ReviewRail } from "../review/ReviewRail";
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

  const groups = useMemo<ReviewGroup[]>(
    () =>
      report.levers.map((lever) => ({
        key: lever.key,
        label: lever.label,
        detail: lever.detail,
        header: (
          <>
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
          </>
        ),
      })),
    [report.levers, inFlight],
  );

  return (
    <ReviewRail
      issues={issues}
      groups={groups}
      draftId={draft.id}
      apply={apply}
      save={save}
      onHighlight={onHighlight}
      onRescore={onRescore}
      onRestoreLever={onRestoreLever}
      groupLabelFor={(key) => report.levers.find((l) => l.key === key)?.label ?? key}
      emptyState={
        <p className="py-8 text-center text-sm text-muted">
          Nothing flagged — this reads GEO-ready.
        </p>
      }
      headerSlot={
        <div className="flex items-center justify-end">
          <Link
            to="/help#geo"
            className="text-xs text-muted underline underline-offset-2 hover:text-ink"
          >
            How these rules work →
          </Link>
        </div>
      }
    />
  );
}
