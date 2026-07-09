/** Weighted overall score (0-100) from the current levers, normalized by the
 * weights of the levers actually present — matching the backend's build_report,
 * so a partial report (or one from a bundle mid-rollout) isn't diluted by a
 * missing lever's weight. Each lever's `weight` is stamped by the backend
 * (see `_lever` in geo.py) — there is no client-side mirror to keep in sync,
 * so this always matches the live weight table, including new levers. */
export function computeTotalScore(
  levers: { key: string; score: number; weight?: number }[],
): number {
  let weighted = 0;
  let wsum = 0;
  for (const l of levers) {
    const w = l.weight ?? 0;
    weighted += l.score * w;
    wsum += w;
  }
  return wsum > 0 ? Math.round(weighted / wsum) : 0;
}
