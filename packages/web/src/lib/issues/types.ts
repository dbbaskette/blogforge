/**
 * The unified issue model shared by the GEO and Proofreader review panels.
 *
 * Every finding from either panel maps to an `Issue`; both panels render the
 * same `<IssueCard>` and drive the same `useIssueLifecycle` state machine, so
 * behaviour can't diverge again. See
 * docs/superpowers/specs/2026-07-02-geo-optimize-ux-design.md.
 */

export type IssueNature = "fix" | "add" | "advisory";
export type IssueStatus = "open" | "review" | "accepted";

export type IssueAction =
  | "ai_fix"
  | "manual_fix"
  | "highlight"
  | "generate"
  | "write_own"
  | "cite_source"
  | "quote_source"
  | "add_fact"
  | "add_date"
  | "dedupe"
  | "dismiss";

export interface Issue {
  /** Stable per finding within a report. */
  id: string;
  panel: "geo" | "proofread";
  /** Lever/check key, e.g. "answer_first", "citations", "grammar". */
  lever: string;
  /** Short headline, e.g. "This section buries its answer". */
  title: string;
  /** Plain-language rationale shown under the title. */
  why: string;
  nature: IssueNature;
  /** Section this issue lives in; "opening" for the lede. */
  sectionId: string;
  /** The flagged passage (fix issues); absent for add/advisory. */
  target?: string;
  /** Which controls this card shows, in order. */
  actions: IssueAction[];
  status: IssueStatus;
}

/** Actions that open an inline editor on the card (user supplies text). */
export const INPUT_ACTIONS: ReadonlySet<IssueAction> = new Set<IssueAction>([
  "manual_fix",
  "write_own",
  "add_fact",
  "add_date",
  "cite_source",
]);

export function isFixNature(issue: Issue): boolean {
  return issue.nature === "fix";
}

export function isInputAction(action: IssueAction): boolean {
  return INPUT_ACTIONS.has(action);
}
