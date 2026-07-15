/**
 * The one per-draft dismissal store for every review panel.
 *
 * Replaces lintDismissals / humanizeDismissals / ShapePanel's inline store.
 * Issue ids are panel-namespaced (`geo:*`, `humanize:*`, `pf:*`, `shape:*`), so
 * a single key per draft is unambiguous. Local-first single-user app, so a
 * browser-local store is sufficient (no server sync).
 */
const KEY = (draftId: string): string => `bf.review.dismissed.${draftId}`;

export function loadDismissed(draftId: string): Set<string> {
  try {
    const raw = localStorage.getItem(KEY(draftId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function save(draftId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(KEY(draftId), JSON.stringify([...ids]));
  } catch {
    /* storage disabled — non-fatal */
  }
}

export function dismiss(draftId: string, issueId: string): Set<string> {
  const ids = loadDismissed(draftId);
  ids.add(issueId);
  save(draftId, ids);
  return ids;
}

export function restore(draftId: string, issueId: string): Set<string> {
  const ids = loadDismissed(draftId);
  ids.delete(issueId);
  save(draftId, ids);
  return ids;
}
