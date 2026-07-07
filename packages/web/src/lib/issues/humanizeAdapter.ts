/**
 * Map a HumanizeReport into the unified Issue model. Every finding becomes one
 * independently-actionable Issue, grouped by lens (rendered as the rail's
 * sections). The rewrite is precomputed by the backend, so `ai_fix` needs no
 * further model call — see `humanizeApply.ts`. A finding whose rewrite changes
 * a fact (guardrail-flagged `needs_review`) is downgraded to advisory so it
 * can't be auto-applied without a look.
 */

import type { HumanizeReport } from "../../api/humanize";
import type { Issue } from "./types";

export function humanizeFindingsToIssues(report: HumanizeReport): Issue[] {
  const issues: Issue[] = [];
  for (const lens of report.lenses) {
    lens.findings.forEach((f, i) => {
      issues.push({
        id: `humanize:${f.lens}:${f.section_id}:${i}`,
        panel: "humanize",
        lever: f.lens,
        title: f.note || "Reads robotic",
        why: f.note,
        nature: f.needs_review ? "advisory" : "fix",
        sectionId: f.section_id,
        target: f.target,
        fixKind: "humanize_rewrite",
        suggestion: f.suggestion,
        actions: ["ai_fix", "manual_fix", "highlight", "dismiss"],
        status: "open",
      });
    });
  }
  return issues;
}
