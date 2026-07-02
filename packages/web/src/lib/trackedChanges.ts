/**
 * Tracked-changes store for panel-applied edits.
 *
 * When a fix from the GEO or Proofreader panel is applied, we diff the section's
 * before/after text (via {@link wordDiff}) and remember only the *added* word
 * runs in a per-draft localStorage list. The editor colors those runs so the
 * writer sees what changed at a glance; approving (per-change or all) or editing
 * the text away removes the runs. The saved markdown never carries markers — the
 * document stays clean for export, lint, and GEO scoring.
 */

import { wordDiff } from "./wordDiff";

export interface PendingChange {
  id: string;
  sectionId: string;
  /** A contiguous run of added words (single line). */
  text: string;
  /** Origin tag, e.g. "geo:bullets" | "lint:fix". */
  source: string;
}

const KEY = (draftId: string): string => `bf.pending.${draftId}`;
let _seq = 0;

export function loadPending(draftId: string): PendingChange[] {
  try {
    const raw = localStorage.getItem(KEY(draftId));
    return raw ? (JSON.parse(raw) as PendingChange[]) : [];
  } catch {
    return [];
  }
}

function save(draftId: string, list: PendingChange[]): void {
  try {
    localStorage.setItem(KEY(draftId), JSON.stringify(list));
  } catch {
    /* storage disabled/full — tracking is a non-fatal review aid */
  }
}

/**
 * Record the added runs of an edit. Returns the ids of the created changes so a
 * panel row can later approve exactly its own runs.
 */
export function trackChange(
  draftId: string,
  sectionId: string,
  before: string,
  after: string,
  source: string,
): string[] {
  const runs = wordDiff(before, after)
    .filter((p) => p.type === "add")
    .flatMap((p) => p.text.split(/\n+/)) // split multi-line adds so each matches per line
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (runs.length === 0) return [];
  const created = runs.map((text) => ({ id: `c${_seq++}`, sectionId, text, source }));
  save(draftId, [...loadPending(draftId), ...created]);
  return created.map((c) => c.id);
}

export function approveChange(draftId: string, ids: string[]): void {
  const drop = new Set(ids);
  save(
    draftId,
    loadPending(draftId).filter((c) => !drop.has(c.id)),
  );
}

export function approveAll(draftId: string): void {
  try {
    localStorage.removeItem(KEY(draftId));
  } catch {
    /* non-fatal */
  }
}

/** Drop any run whose text no longer appears in its section — the writer edited
 *  the colored words themselves, which finalizes them. */
export function prunePending(
  draftId: string,
  sections: { id: string; content_md: string }[],
): void {
  const byId = new Map(sections.map((s) => [s.id, s.content_md]));
  save(
    draftId,
    loadPending(draftId).filter((c) => (byId.get(c.sectionId) ?? "").includes(c.text)),
  );
}

export function pendingTextsFor(draftId: string, sectionId: string): string[] {
  return loadPending(draftId)
    .filter((c) => c.sectionId === sectionId)
    .map((c) => c.text);
}
