/**
 * Turns a draft's stage + the cached GEO/Shape results (from panelCache) into
 * small "health" signals for the Drafts list, so the list reads as a work
 * queue — what each piece needs next — instead of a filing cabinet.
 */
import type { DraftStage } from "../api/drafts";
import type { GeoReport } from "../api/geo";
import type { SuggestResult } from "../api/suggest";
import { peekCached } from "./panelCache";

export interface DraftHealth {
  /** GEO letter grade, if the GEO panel has been run on this draft. */
  geoGrade?: string;
  geoScore?: number;
  /** Total open one-click fixes across the cached GEO + Shape results. */
  fixes: number;
  /** Newest timestamp among the cached analyses (ms), or null if none. */
  at: number | null;
  /** A short "what to do next" nudge derived from the draft's stage. */
  nextStep: string;
}

const STAGE_NEXT: Record<DraftStage, string> = {
  research: "Add an outline",
  outline: "Write the sections",
  sections: "Review & polish",
};

function countGeoFixes(report: GeoReport): number {
  return report.levers.reduce((n, l) => n + l.findings.length, 0);
}

function countShapeFixes(result: SuggestResult): number {
  return Object.values(result).reduce((n, arr) => n + (arr?.length ?? 0), 0);
}

export function readDraftHealth(draftId: string, stage: DraftStage): DraftHealth {
  const geo = peekCached<GeoReport>("geo", draftId);
  const shape = peekCached<SuggestResult>("shape", draftId);
  const fixes = (geo ? countGeoFixes(geo.data) : 0) + (shape ? countShapeFixes(shape.data) : 0);
  const at = Math.max(geo?.at ?? 0, shape?.at ?? 0) || null;
  return {
    geoGrade: geo?.data.grade,
    geoScore: geo?.data.score,
    fixes,
    at,
    nextStep: STAGE_NEXT[stage],
  };
}
