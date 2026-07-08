import { useCallback, useState } from "react";

import type { Issue, IssueAction, IssueStatus } from "../../lib/issues/types";

/** Which field an apply wrote — so undo restores the right one. */
export type AppliedField = "content" | "title" | "opening";

/** What an apply produced — enough to highlight and to undo. */
export interface Applied {
  sectionId: string;
  before: string;
  after: string;
  /** Text run to highlight as under-review; defaults to `after`. */
  highlight?: string;
  /** The field written (section body, section title, or the article opening). */
  field?: AppliedField;
}

export interface UseIssueLifecycleArgs {
  draftId: string;
  /** Perform the content change for an action; return null to no-op (e.g. a
   *  cancelled input). Must persist the change itself; the hook records undo. */
  apply: (issue: Issue, action: IssueAction, input?: string) => Promise<Applied | null>;
  /** Restore a field on undo (routes by `field`: body / title / opening). */
  save: (sectionId: string, content: string, field?: AppliedField) => Promise<void> | void;
  onHighlight?: (sectionId: string, text: string | null, kind: "under-review" | "locate") => void;
  onRescore?: (lever: string) => void;
  /** Called on undo instead of onRescore when provided — lets the panel
   *  restore a cached pre-fix score instantly instead of re-running a model
   *  pass just to arrive back where it started. */
  onUndoRescore?: (lever: string) => void;
}

interface LedgerEntry {
  sectionId: string;
  before: string;
  lever: string;
  field: AppliedField;
}

const ledgerKey = (draftId: string): string => `bf.review.undo.${draftId}`;

function loadLedger(draftId: string): Record<string, LedgerEntry> {
  try {
    return JSON.parse(localStorage.getItem(ledgerKey(draftId)) ?? "{}");
  } catch {
    return {};
  }
}

function saveLedger(draftId: string, map: Record<string, LedgerEntry>): void {
  try {
    localStorage.setItem(ledgerKey(draftId), JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

// Per-issue resolution status, persisted so a fix/dismissal survives closing
// and reopening the panel (issue ids are deterministic per report, so they line
// up with the saved findings on reload). Keyed by draft. "open" is never
// stored — it's the absence of a decision, so undo/reopen just deletes the key.
const statusKey = (draftId: string): string => `bf.review.status.${draftId}`;

function loadStatuses(draftId: string): Record<string, IssueStatus> {
  try {
    return JSON.parse(localStorage.getItem(statusKey(draftId)) ?? "{}");
  } catch {
    return {};
  }
}

function persistStatus(draftId: string, issueId: string, next: IssueStatus | null): void {
  try {
    const map = loadStatuses(draftId);
    if (next === null || next === "open") delete map[issueId];
    else map[issueId] = next;
    localStorage.setItem(statusKey(draftId), JSON.stringify(map));
  } catch {
    /* storage disabled — persistence is a nicety, not required */
  }
}

/**
 * The single state machine both review panels run through: apply → review →
 * accept, plus undo. Keeps per-issue status in component state and an undo
 * ledger in localStorage (so undo survives a reload within a session).
 */
export function useIssueLifecycle(args: UseIssueLifecycleArgs) {
  const { draftId, apply, save, onHighlight, onRescore, onUndoRescore } = args;
  // Hydrate the resolution status from the last session for this draft, so
  // corrections/dismissals are still applied when the panel is reopened.
  const [status, setStatus] = useState<Record<string, IssueStatus>>(() => loadStatuses(draftId));
  // The issue + action currently running (drives per-card spinners and the
  // blocking "applying…" modal for slow model calls).
  const [busy, setBusy] = useState<{ id: string; action: IssueAction | "undo" } | null>(null);
  const busyId = busy?.id ?? null;
  const busyAction = busy?.action ?? null;
  // Per-issue apply error (e.g. the target text changed since the pass ran, so
  // there is nothing to replace). Surfaced on the card so a failed fix is never
  // a silent no-op.
  const [errors, setErrors] = useState<Record<string, string>>({});

  const statusOf = useCallback(
    (issue: Issue): IssueStatus => status[issue.id] ?? issue.status,
    [status],
  );

  const errorOf = useCallback((issue: Issue): string | null => errors[issue.id] ?? null, [errors]);

  const run = useCallback(
    async (issue: Issue, action: IssueAction, input?: string): Promise<void> => {
      if (action === "highlight") {
        onHighlight?.(issue.sectionId, issue.target ?? issue.title, "locate");
        return;
      }
      setBusy({ id: issue.id, action });
      // Clear any prior error for this issue when we retry.
      setErrors((e) => {
        if (!e[issue.id]) return e;
        const next = { ...e };
        delete next[issue.id];
        return next;
      });
      try {
        const res = await apply(issue, action, input);
        if (!res) return;
        // Dismissing an advisory has no content change — go straight to green.
        if (action === "dismiss") {
          setStatus((s) => ({ ...s, [issue.id]: "accepted" }));
          persistStatus(draftId, issue.id, "accepted");
          return;
        }
        const ledger = loadLedger(draftId);
        ledger[issue.id] = {
          sectionId: res.sectionId,
          before: res.before,
          lever: issue.lever,
          field: res.field ?? "content",
        };
        saveLedger(draftId, ledger);
        onHighlight?.(res.sectionId, res.highlight ?? res.after, "under-review");
        onRescore?.(issue.lever);
        setStatus((s) => ({ ...s, [issue.id]: "review" }));
        persistStatus(draftId, issue.id, "review");
      } catch (e) {
        // A genuine apply failure (stale target, etc.) — surface it on the card
        // and leave the issue open so the writer can re-analyze or fix manually.
        setErrors((prev) => ({
          ...prev,
          [issue.id]: e instanceof Error ? e.message : "Couldn't apply this fix.",
        }));
      } finally {
        setBusy(null);
      }
    },
    [draftId, apply, onHighlight, onRescore],
  );

  const accept = useCallback(
    (issue: Issue): void => {
      onHighlight?.(issue.sectionId, null, "under-review");
      setStatus((s) => ({ ...s, [issue.id]: "accepted" }));
      persistStatus(draftId, issue.id, "accepted");
    },
    [draftId, onHighlight],
  );

  const undo = useCallback(
    async (issue: Issue): Promise<void> => {
      const ledger = loadLedger(draftId);
      const entry = ledger[issue.id];
      setBusy({ id: issue.id, action: "undo" });
      try {
        if (entry) {
          await save(entry.sectionId, entry.before, entry.field);
          onHighlight?.(entry.sectionId, null, "under-review");
          (onUndoRescore ?? onRescore)?.(entry.lever);
          delete ledger[issue.id];
          saveLedger(draftId, ledger);
        }
        setStatus((s) => ({ ...s, [issue.id]: "open" }));
        // "open" is the absence of a decision — drop it from the saved ledger
        // so a reopened panel shows it open again.
        persistStatus(draftId, issue.id, "open");
      } finally {
        setBusy(null);
      }
    },
    [draftId, save, onHighlight, onRescore, onUndoRescore],
  );

  return { statusOf, errorOf, busyId, busyAction, run, accept, undo };
}
