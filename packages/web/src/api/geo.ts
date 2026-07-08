import { api } from "./client";

export type GeoFix =
  | "answer_first"
  | "question_heading"
  | "definitional"
  | "definitional_improve"
  | "faq"
  | "comparison_table"
  | "takeaways"
  | "cite_reference"
  | null;

/** Per-finding one-click action (server-tagged). */
export type GeoFindingFix =
  | "answer_first"
  | "question_heading"
  | "bullets"
  | "self_contained"
  | "dedupe_opening"
  | "comparison_table"
  | "cite_reference"
  | "quote_reference"
  | "alt_text";

export interface GeoFinding {
  section_id?: string;
  target?: string;
  note: string;
  /** For factual density: WHAT real data to add (never invented values). */
  suggestion?: string;
  fix?: GeoFindingFix | "";
  /** One-sentence concrete payoff for this specific finding (falls back to the
   * lever's impact when absent). */
  impact?: string;
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
  /** One-sentence concrete payoff for fixing this lever — why it moves citations. */
  impact?: string;
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

/** Verbatim quote candidates lifted from one attached reference (server filters
 * out anything not an exact substring of the reference — never fabricated). */
export async function geoQuotes(draftId: string, referenceId: string): Promise<string[]> {
  const { quotes } = await api<{ quotes: string[] }>(
    `/api/drafts/${encodeURIComponent(draftId)}/geo/quotes`,
    { method: "POST", body: JSON.stringify({ reference_id: referenceId }) },
  );
  return quotes;
}

/** Rewrite a passage to attribute (and link) an attached reference. `quote`
 * (optional, verbatim) is woven in for the quote_reference flow. Returns the
 * rewritten passage; the client splices it over the original target text. */
export async function geoCite(
  draftId: string,
  body: { section_id: string; target: string; reference_id: string; quote?: string },
): Promise<string> {
  const { passage } = await api<{ passage: string }>(
    `/api/drafts/${encodeURIComponent(draftId)}/geo/cite`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return passage;
}

/** Grounded key-takeaways bullets (TL;DR) generated from the draft. */
export async function generateTakeaways(draftId: string): Promise<string[]> {
  const { takeaways } = await api<{ takeaways: string[] }>(
    `/api/drafts/${encodeURIComponent(draftId)}/geo/takeaways`,
    { method: "POST" },
  );
  return takeaways;
}

/** Descriptive alt text for one image, from its surrounding prose. */
export async function geoAlt(draftId: string, target: string): Promise<string> {
  const { alt } = await api<{ alt: string }>(`/api/drafts/${encodeURIComponent(draftId)}/geo/alt`, {
    method: "POST",
    body: JSON.stringify({ target }),
  });
  return alt;
}

/** Natural-language queries this post should be the canonical answer for — for
 * the writer's manual weekly citation checks in ChatGPT/Perplexity/AI Overviews. */
export async function geoQueries(draftId: string): Promise<string[]> {
  const { queries } = await api<{ queries: string[] }>(
    `/api/drafts/${encodeURIComponent(draftId)}/geo/queries`,
    { method: "POST" },
  );
  return queries;
}
