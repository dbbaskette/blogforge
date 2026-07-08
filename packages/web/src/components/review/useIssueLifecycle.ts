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

/**
 * The single state machine both review panels run through: apply → review →
 * accept, plus undo. Keeps per-issue status in component state and an undo
 * ledger in localStorage (so undo survives a reload within a session).
 */
export function useIssueLifecycle(args: UseIssueLifecycleArgs) {
  const { draftId, apply, save, onHighlight, onRescore, onUndoRescore } = args;
  const [status, setStatus] = useState<Record<string, IssueStatus>>({});
  // The issue + action currently running (drives per-card spinners and the
  // blocking "applying…" modal for slow model calls).
  const [busy, setBusy] = useState<{ id: string; action: IssueAction | "undo" } | null>(null);
  const busyId = busy?.id ?? null;
  const busyAction = busy?.action ?? null;

  const statusOf = useCallback(
    (issue: Issue): IssueStatus => status[issue.id] ?? issue.status,
    [status],
  );

  const run = useCallback(
    async (issue: Issue, action: IssueAction, input?: string): Promise<void> => {
      if (action === "highlight") {
        onHighlight?.(issue.sectionId, issue.target ?? issue.title, "locate");
        return;
      }
      setBusy({ id: issue.id, action });
      try {
        const res = await apply(issue, action, input);
        if (!res) return;
        // Dismissing an advisory has no content change — go straight to green.
        if (action === "dismiss") {
          setStatus((s) => ({ ...s, [issue.id]: "accepted" }));
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
    },
    [onHighlight],
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
      } finally {
        setBusy(null);
      }
    },
    [draftId, save, onHighlight, onRescore, onUndoRescore],
  );

  return { statusOf, busyId, busyAction, run, accept, undo };
}
