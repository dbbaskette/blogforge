import type { DraftStage } from "../../api/drafts";
import { readDraftHealth } from "../../lib/draftHealth";

function gradeClass(grade: string): string {
  if (grade === "A" || grade === "B") return "nb-pill nb-pill-ready";
  if (grade === "C") return "nb-pill nb-pill-gen";
  return "nb-pill nb-pill-failed";
}

/**
 * Compact health signals for a Drafts-list card: a "next step" nudge from the
 * draft's stage, plus a GEO grade and open-fix count when the analysis panels
 * have been run (read from the local cache — no extra requests).
 */
export function DraftHealthBadges({
  draftId,
  stage,
}: {
  draftId: string;
  stage: DraftStage;
}): JSX.Element {
  const health = readDraftHealth(draftId, stage);
  return (
    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-2">→ {health.nextStep}</span>
      {health.geoGrade && (
        <span
          className={gradeClass(health.geoGrade)}
          title={`GEO readiness score ${health.geoScore}`}
        >
          GEO {health.geoGrade}
        </span>
      )}
      {health.fixes > 0 && (
        <span className="nb-pill nb-pill-edited" title="Open one-click fixes from GEO / Shape">
          {health.fixes} to fix
        </span>
      )}
    </div>
  );
}
