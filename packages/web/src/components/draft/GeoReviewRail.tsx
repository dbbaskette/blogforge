/**
 * The GEO panel's findings list, rendered on the unified issue-card model.
 * Every finding becomes an Issue (geoFindingsToIssues) and flows through the
 * shared IssueCard + useIssueLifecycle state machine (open → review → accepted,
 * with per-issue undo) — the same components the Proofreader uses, so the two
 * panels can't drift apart again. The per-lever score bars are preserved; each
 * lever heads its group of cards.
 */

import { useMemo } from "react";

import type { Draft } from "../../api/drafts";
import type { GeoReport } from "../../api/geo";
import { geoFindingsToIssues } from "../../lib/issues/geoAdapter";
import { IssueCard } from "../review/IssueCard";
import { useIssueLifecycle } from "../review/useIssueLifecycle";
import { makeGeoApply } from "./geoApply";

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
  onRescore?: (lever: string) => void;
  onHighlight?: (sectionId: string, text: string | null, kind: "under-review" | "locate") => void;
}

export function GeoReviewRail({
  report,
  draft,
  onSectionSave,
  onOpeningSave,
  onRescore,
  onHighlight,
}: GeoReviewRailProps): JSX.Element {
  const issues = useMemo(() => geoFindingsToIssues(report), [report]);
  const apply = useMemo(
    () => makeGeoApply({ draft, onSectionSave, onOpeningSave }),
    [draft, onSectionSave, onOpeningSave],
  );
  const { statusOf, busyId, run, accept, undo } = useIssueLifecycle({
    draftId: draft.id,
    apply,
    save: onSectionSave,
    onHighlight,
    onRescore,
  });

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
      {report.levers.map((lever) => {
        const leverIssues = byLever.get(lever.key) ?? [];
        if (leverIssues.length === 0) return null;
        return (
          <section key={lever.key} className="glass-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">{lever.label}</h3>
              <span
                className="text-xs font-mono tabular-nums"
                style={{ color: barColor(lever.score) }}
              >
                {lever.score}
              </span>
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
                  onAction={(action, inputText) => void run(issue, action, inputText)}
                  onAccept={() => accept(issue)}
                  onUndo={() => void undo(issue)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
