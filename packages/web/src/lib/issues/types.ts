/**
 * The unified issue model shared by every review panel (GEO, Proofread, Humanize, Shape).
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
  | "choose_option"
  | "cite_source"
  | "quote_source"
  | "add_fact"
  | "add_date"
  | "dedupe"
  | "dismiss";

export interface Issue {
  /** Stable per finding within a report. */
  id: string;
  panel: "geo" | "proofread" | "humanize" | "shape";
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
  /** Precomputed rewrite for the flagged passage (Humanize findings carry the
   *  suggestion up front, so apply needs no model call). */
  suggestion?: string;
  /** Concrete alternatives the writer picks between (Shape's reword options /
   *  expand ideas). Rendered as chips when `choose_option` is in `actions`. */
  options?: string[];
  /** Prefix for the impact line, e.g. "GEO". Absent renders it unprefixed —
   *  keeps IssueCard panel-neutral. */
  impactLabel?: string;
  /** The backend's specific fix tag (e.g. "bullets", "alt_text",
   *  "question_heading", "faq") — lets apply dispatch precisely where a lever
   *  hosts more than one kind of fix. Falls back to the lever key. */
  fixKind?: string;
  /** Which controls this card shows, in order. */
  actions: IssueAction[];
  status: IssueStatus;
  /** One-sentence concrete payoff (GEO panel: why this moves citations). */
  impact?: string;
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
