import { useCallback, useState } from "react";

import type { Issue, IssueAction, IssueStatus } from "../../lib/issues/types";

/** What an apply produced — enough to highlight and to undo. */
export interface Applied {
  sectionId: string;
  before: string;
  after: string;
  /** Text run to highlight as under-review; defaults to `after`. */
  highlight?: string;
}

export interface UseIssueLifecycleArgs {
  draftId: string;
  /** Perform the content change for an action; return null to no-op (e.g. a
   *  cancelled input). Must persist the change itself; the hook records undo. */
  apply: (issue: Issue, action: IssueAction, input?: string) => Promise<Applied | null>;
  /** Restore a section's content on undo. */
  save: (sectionId: string, content: string) => Promise<void> | void;
  onHighlight?: (
    sectionId: string,
    text: string | null,
    kind: "under-review" | "locate",
  ) => void;
  onRescore?: (lever: string) => void;
}

interface LedgerEntry {
  sectionId: string;
  before: string;
  lever: string;
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
  const { draftId, apply, save, onHighlight, onRescore } = args;
  const [status, setStatus] = useState<Record<string, IssueStatus>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

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
      setBusyId(issue.id);
      try {
        const res = await apply(issue, action, input);
        if (!res) return;
        // Dismissing an advisory has no content change — go straight to green.
        if (action === "dismiss") {
          setStatus((s) => ({ ...s, [issue.id]: "accepted" }));
          return;
        }
        const ledger = loadLedger(draftId);
        ledger[issue.id] = { sectionId: res.sectionId, before: res.before, lever: issue.lever };
        saveLedger(draftId, ledger);
        onHighlight?.(res.sectionId, res.highlight ?? res.after, "under-review");
        onRescore?.(issue.lever);
        setStatus((s) => ({ ...s, [issue.id]: "review" }));
      } finally {
        setBusyId(null);
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
      setBusyId(issue.id);
      try {
        if (entry) {
          await save(entry.sectionId, entry.before);
          onHighlight?.(entry.sectionId, null, "under-review");
          onRescore?.(entry.lever);
          delete ledger[issue.id];
          saveLedger(draftId, ledger);
        }
        setStatus((s) => ({ ...s, [issue.id]: "open" }));
      } finally {
        setBusyId(null);
      }
    },
    [draftId, save, onHighlight, onRescore],
  );

  return { statusOf, busyId, run, accept, undo };
}
