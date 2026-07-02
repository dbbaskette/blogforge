import { api } from "./client";

export type GeoFix =
  | "answer_first"
  | "question_heading"
  | "definitional"
  | "definitional_improve"
  | "faq"
  | "comparison_table"
  | null;

/** Per-finding one-click action (server-tagged). */
export type GeoFindingFix =
  | "answer_first"
  | "question_heading"
  | "bullets"
  | "self_contained"
  | "dedupe_opening"
  | "comparison_table";

export interface GeoFinding {
  section_id?: string;
  target?: string;
  note: string;
  /** For factual density: WHAT real data to add (never invented values). */
  suggestion?: string;
  fix?: GeoFindingFix | "";
}

export interface GeoLever {
  key: string;
  label: string;
  score: number;
  /** This lever's share of the overall score — used to recompute the total
   * client-side after a targeted per-lever re-score. */
  weight?: number;
  detail: string;
  findings: GeoFinding[];
  fix: GeoFix;
}

export interface GeoReport {
  score: number;
  grade: string;
  levers: GeoLever[];
}

export interface FaqItem {
  q: string;
  a: string;
}

/** Deterministic structural checks + one voice-aware LLM pass → GEO report. */
export function analyzeGeo(draftId: string): Promise<GeoReport> {
  return api<GeoReport>(`/api/drafts/${encodeURIComponent(draftId)}/geo`, { method: "POST" });
}

/**
 * Re-score ONLY the given levers after a targeted fix. Returns just those
 * (keyed by lever key); the caller merges them into the current report so
 * unaffected levers keep their scores. Structural levers recompute instantly;
 * semantic ones cost one LLM pass.
 */
export async function rescoreGeo(
  draftId: string,
  levers: string[],
): Promise<Record<string, GeoLever>> {
  const res = await api<{ levers: Record<string, GeoLever> }>(
    `/api/drafts/${encodeURIComponent(draftId)}/geo/rescore`,
    { method: "POST", body: JSON.stringify({ levers }) },
  );
  return res.levers;
}

/** Generate grounded FAQ pairs from the draft to add an FAQ section. */
export async function generateFaq(draftId: string, n = 4): Promise<FaqItem[]> {
  const { faqs } = await api<{ faqs: FaqItem[] }>(
    `/api/drafts/${encodeURIComponent(draftId)}/geo/faq`,
    { method: "POST", body: JSON.stringify({ n }) },
  );
  return faqs;
}

/**
 * One citable definitional sentence generated from the draft. The client
 * prepends it verbatim — and can remove exactly it on undo.
 */
export async function generateOpener(draftId: string): Promise<string> {
  const { opener } = await api<{ opener: string }>(
    `/api/drafts/${encodeURIComponent(draftId)}/geo/opener`,
    { method: "POST" },
  );
  return opener;
}

/**
 * A grounded Markdown comparison table built from one section's prose. The
 * client appends it to that section (with a version snapshot for undo).
 */
export async function generateTable(draftId: string, sectionId: string): Promise<string> {
  const { table } = await api<{ table: string }>(
    `/api/drafts/${encodeURIComponent(draftId)}/geo/table`,
    { method: "POST", body: JSON.stringify({ section_id: sectionId }) },
  );
  return table;
}
