import type { IssueAction } from "../../lib/issues/types";

/**
 * Labels for the blocking "applying…" modal, keyed by the action in flight.
 * Only slow model-backed actions get a modal; fast local edits (manual edit,
 * dismiss, dedupe, write-my-own, undo) don't and are absent here.
 */
const SLOW_LABEL: Partial<Record<IssueAction, string>> = {
  ai_fix: "Applying the AI fix…",
  add_fact: "Weaving in your fact…",
  add_date: "Weaving in the date…",
  generate: "Generating…",
  cite_source: "Citing the source…",
  quote_source: "Pulling a quote…",
};

/** The modal label for a running action, or null when it needs no modal. */
export function reviewBusyLabel(action: string | null | undefined): string | null {
  return action && action in SLOW_LABEL ? (SLOW_LABEL[action as IssueAction] ?? null) : null;
}
