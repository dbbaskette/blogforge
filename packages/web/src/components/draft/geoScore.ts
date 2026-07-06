/** Each lever's share of the total, mirroring the backend's _WEIGHTS. Kept here
 * (rather than trusting lever.weight) so the total still recomputes correctly
 * even for a report cached by an older bundle whose levers lack `weight`. */
const LEVER_WEIGHTS: Record<string, number> = {
  answer_first: 0.16,
  factual_density: 0.16,
  citations: 0.1,
  definitional_opener: 0.08,
  question_headings: 0.08,
  skimmability: 0.08,
  brand_explicit: 0.06,
  faq: 0.06,
  chunking: 0.06,
  takeaways: 0.06,
  freshness: 0.06,
  comparison_table: 0.04,
};

/** Weighted overall score (0-100) from the current levers, normalized by the
 * weights of the levers actually present — matching the backend's build_report,
 * so a partial report (or one from a bundle mid-rollout) isn't diluted by a
 * missing lever's weight. */
export function computeTotalScore(
  levers: { key: string; score: number; weight?: number }[],
): number {
  let weighted = 0;
  let wsum = 0;
  for (const l of levers) {
    const w = LEVER_WEIGHTS[l.key] ?? l.weight ?? 0;
    weighted += l.score * w;
    wsum += w;
  }
  return wsum > 0 ? Math.round(weighted / wsum) : 0;
}
