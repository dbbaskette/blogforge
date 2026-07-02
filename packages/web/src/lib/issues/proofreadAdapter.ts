/**
 * Map Proofreader (lint) findings into the unified Issue model, so the
 * Proofreader renders on the exact same IssueCard + lifecycle as the GEO panel.
 * Only actionable findings (violations + repetitions) become issues; positive
 * "hits" are signals, not problems.
 */

import type { LintFinding } from "../../api/drafts";
import type { Issue } from "./types";

function whyFor(kind: LintFinding["kind"]): string {
  return kind === "repetition"
    ? "Repeated phrasing worth varying."
    : "A voice-rule violation to clean up.";
}

export interface LintResult {
  violations: LintFinding[];
  repetitions: LintFinding[];
  hits?: LintFinding[];
}

export function proofreadFindingsToIssues(lint: LintResult): Issue[] {
  const findings = [...lint.violations, ...lint.repetitions];
  return findings.map((f) => {
    const hasTarget = Boolean(f.match && f.section_id);
    return {
      id: `pf:${f.id}`,
      panel: "proofread" as const,
      lever: f.rule || f.kind,
      title: f.message,
      why: whyFor(f.kind),
      nature: "fix" as const,
      sectionId: f.section_id ?? "",
      target: f.match || undefined,
      // Unlocated findings can only be dismissed; located ones get the full set.
      actions: hasTarget
        ? (["ai_fix", "manual_fix", "highlight", "dismiss"] as const).slice()
        : (["dismiss"] as const).slice(),
      status: "open" as const,
    };
  });
}
