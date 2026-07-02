/**
 * Map a GeoReport into the unified Issue model. Every finding becomes one
 * independently-actionable Issue; the finding's server-tagged `fix` (or the
 * lever's lever-level `fix`) decides the issue's nature and action set.
 */

import type { GeoLever, GeoReport } from "../../api/geo";
import type { Issue, IssueAction, IssueNature } from "./types";

interface ActionSpec {
  nature: IssueNature;
  actions: IssueAction[];
}

/** Per-finding fix → nature + actions. */
const FINDING_FIX: Record<string, ActionSpec> = {
  answer_first: { nature: "fix", actions: ["ai_fix", "manual_fix", "highlight"] },
  question_heading: { nature: "fix", actions: ["ai_fix", "manual_fix", "highlight"] },
  bullets: { nature: "fix", actions: ["ai_fix", "manual_fix", "highlight"] },
  self_contained: { nature: "fix", actions: ["ai_fix", "manual_fix", "highlight"] },
  dedupe_opening: { nature: "fix", actions: ["dedupe", "highlight"] },
  comparison_table: { nature: "add", actions: ["generate", "write_own"] },
  cite_reference: { nature: "fix", actions: ["cite_source", "quote_source", "highlight"] },
  quote_reference: { nature: "fix", actions: ["quote_source", "highlight"] },
  alt_text: { nature: "fix", actions: ["generate", "write_own", "highlight"] },
};

/** Lever-level fix (used when a finding carries no per-finding fix). */
const LEVER_FIX: Record<string, ActionSpec> = {
  faq: { nature: "add", actions: ["generate", "write_own"] },
  takeaways: { nature: "add", actions: ["generate", "write_own"] },
  definitional: { nature: "add", actions: ["generate", "write_own"] },
  definitional_improve: { nature: "fix", actions: ["ai_fix", "manual_fix"] },
  comparison_table: { nature: "add", actions: ["generate", "write_own"] },
};

/** Levers whose findings are guidance you can't auto-fix without fabricating. */
const ADVISORY_LEVERS = new Set(["freshness"]);

function specFor(lever: GeoLever, findingFix: string): ActionSpec {
  if (findingFix && FINDING_FIX[findingFix]) return FINDING_FIX[findingFix];
  if (lever.fix && LEVER_FIX[lever.fix]) return LEVER_FIX[lever.fix];
  if (lever.key === "brand_explicit") {
    return { nature: "fix", actions: ["ai_fix", "manual_fix", "highlight"] };
  }
  if (ADVISORY_LEVERS.has(lever.key)) {
    return { nature: "advisory", actions: ["add_date", "highlight", "dismiss"] };
  }
  // Flag-only fallback: still resolvable via Dismiss so nothing nags forever.
  return { nature: "advisory", actions: ["dismiss"] };
}

export function geoFindingsToIssues(report: GeoReport): Issue[] {
  const issues: Issue[] = [];
  for (const lever of report.levers) {
    lever.findings.forEach((finding, i) => {
      const spec = specFor(lever, finding.fix ?? "");
      issues.push({
        id: `${lever.key}:${i}`,
        panel: "geo",
        lever: lever.key,
        title: finding.note || lever.label,
        why: lever.detail || lever.label,
        nature: spec.nature,
        sectionId: finding.section_id ?? "",
        target: finding.target,
        actions: spec.actions,
        status: "open",
      });
    });
  }
  return issues;
}
