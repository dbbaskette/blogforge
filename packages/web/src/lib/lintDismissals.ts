/**
 * Per-draft "leave it" dismissals for lint findings, persisted in localStorage.
 *
 * A finding's stable `id` (from the backend) is stored so a dismissed finding
 * stays hidden across re-lints and reloads. Local-first single-user app, so a
 * browser-local store is sufficient (no server sync).
 */
const KEY = (draftId: string): string => `bf.lint.dismissed.${draftId}`;

export function loadDismissed(draftId: string): Set<string> {
  try {
    const raw = localStorage.getItem(KEY(draftId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
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

export function dismiss(draftId: string, findingId: string): Set<string> {
  const ids = loadDismissed(draftId);
  ids.add(findingId);
  save(draftId, ids);
  return ids;
}

export function restore(draftId: string, findingId: string): Set<string> {
  const ids = loadDismissed(draftId);
  ids.delete(findingId);
  save(draftId, ids);
  return ids;
}
