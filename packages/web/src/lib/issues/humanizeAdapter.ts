/**
 * Map a HumanizeReport into the unified Issue model. Every finding becomes one
 * independently-actionable Issue, grouped by lens (rendered as the rail's
 * sections). The rewrite is precomputed by the backend, so `ai_fix` needs no
 * further model call — see `humanizeApply.ts`. A finding whose rewrite changes
 * a fact (guardrail-flagged `needs_review`) is downgraded to advisory so it
 * can't be auto-applied without a look.
 */

import type { HumanizeReport } from "../../api/humanize";
import { makeIdFactory } from "./issueIds";
import type { Issue } from "./types";

export function humanizeFindingsToIssues(report: HumanizeReport): Issue[] {
  const nextId = makeIdFactory();
  const issues: Issue[] = [];
  for (const lens of report.lenses) {
    for (const f of lens.findings) {
      issues.push({
        id: nextId("humanize", f.lens, {
          sectionId: f.section_id,
          target: f.target,
          title: f.note || "Reads robotic",
        }),
        panel: "humanize",
        lever: f.lens,
        title: f.note || "Reads robotic",
        // The note IS the title — a why would print the same sentence twice.
        why: "",
        nature: f.needs_review ? "advisory" : "fix",
        sectionId: f.section_id,
        target: f.target,
        fixKind: "humanize_rewrite",
        suggestion: f.suggestion,
        // Guardrail: a fact-changing rewrite (needs_review) must NOT be
        // one-click applied — drop ai_fix so the writer has to open it and
        // apply by hand, mirroring geoAdapter's advisory convention.
        actions: f.needs_review
          ? ["manual_fix", "highlight", "dismiss"]
          : ["ai_fix", "manual_fix", "highlight", "dismiss"],
        status: "open",
      });
    }
  }
  return issues;
}
