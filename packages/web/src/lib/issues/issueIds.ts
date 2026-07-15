/**
 * Stable, content-derived issue ids.
 *
 * Ids used to be position-based (`${lever}:${i}`), so a re-analysis returning a
 * different number of findings shifted every index — and a persisted decision
 * (status, dismissal) silently attached to a DIFFERENT finding. Hashing the
 * finding's own content instead means the same finding keeps its id across runs.
 */

export interface IdParts {
  sectionId?: string;
  target?: string;
  title?: string;
}

/** djb2 — deterministic, dependency-free, good enough to key local decisions. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function issueId(panel: string, lever: string, parts: IdParts): string {
  const basis = `${parts.sectionId ?? ""} ${parts.target ?? ""} ${parts.title ?? ""}`;
  return `${panel}:${lever}:${hash(basis)}`;
}

/**
 * Ids are unique per report, not globally: two findings can legitimately carry
 * identical content (e.g. the same phrase flagged twice). Suffix repeats so each
 * card still gets its own id within one report.
 */
export function makeIdFactory(): (panel: string, lever: string, parts: IdParts) => string {
  const seen = new Map<string, number>();
  return (panel, lever, parts) => {
    const base = issueId(panel, lever, parts);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  };
}
