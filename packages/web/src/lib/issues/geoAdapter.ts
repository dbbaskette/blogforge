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
  cite_reference: { nature: "fix", actions: ["cite_source", "highlight"] },
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
  // Rescues answer_first findings whose section title the model paraphrased, so
  // the per-finding fix key came back empty. No highlight — there's no anchor.
  answer_first: { nature: "fix", actions: ["ai_fix", "manual_fix"] },
};

/** Levers whose findings are guidance you can't auto-fix without fabricating. */
const ADVISORY_LEVERS = new Set(["freshness"]);

function specFor(lever: GeoLever, findingFix: string): ActionSpec {
  if (findingFix && FINDING_FIX[findingFix]) return FINDING_FIX[findingFix];
  if (lever.fix && LEVER_FIX[lever.fix]) return LEVER_FIX[lever.fix];
  if (lever.key === "brand_explicit") {
    return { nature: "fix", actions: ["ai_fix", "manual_fix", "highlight"] };
  }
  if (lever.key === "factual_density") {
    // Thin spots: the writer supplies a real stat (add_fact); fluffy prose: the
    // model tightens it (ai_fix). Both are offered so the lever is actionable.
    return { nature: "fix", actions: ["add_fact", "ai_fix", "highlight"] };
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
      const fix = finding.fix ?? "";
      const spec = specFor(lever, fix);
      // A citations claim matched to an attached source already carries its
      // rewrite (the link spliced in): offer a one-click AI fix that applies it
      // client-side, instead of the manual "supply a source" (cite_source) flow.
      const specActions =
        fix === "cite_reference" && finding.suggestion
          ? (["ai_fix", "manual_fix", "highlight"] as IssueAction[])
          : spec.actions;
      // Highlight only makes sense when there's something to locate. A finding
      // with neither a target nor a section (a document-global advisory like
      // "no dates anywhere") would highlight nothing — drop the dead button.
      const actions =
        !finding.target && !finding.section_id
          ? specActions.filter((a) => a !== "highlight")
          : specActions;
      issues.push({
        id: `${lever.key}:${i}`,
        panel: "geo",
        lever: lever.key,
        title: finding.note || lever.label,
        why: lever.detail || lever.label,
        nature: spec.nature,
        sectionId: finding.section_id ?? "",
        target: finding.target,
        // A citations finding that matched an attached source carries the
        // rewritten sentence (link spliced in) — apply uses it as a client-side
        // splice, no model call (like Humanize).
        suggestion: finding.suggestion,
        // The specific fix the apply layer dispatches on (finding-level, then
        // lever-level, then the lever key as a last resort).
        fixKind: fix || lever.fix || lever.key,
        actions,
        status: "open",
        impact: finding.impact || lever.impact,
        // GEO is the only panel that prefixes its impact line; IssueCard no
        // longer hardcodes it.
        impactLabel: "GEO",
      });
    });

    // A deficient lever can offer a lever-level fix (e.g. "add a key-takeaways
    // block") without any per-finding anchor. With no findings it would emit no
    // card at all, leaving that generative action unreachable — synthesize one.
    if (lever.findings.length === 0 && lever.fix && LEVER_FIX[lever.fix]) {
      const spec = LEVER_FIX[lever.fix];
      issues.push({
        id: `${lever.key}:lever`,
        panel: "geo",
        lever: lever.key,
        title: lever.detail || lever.label,
        why: lever.detail || lever.label,
        nature: spec.nature,
        sectionId: "",
        target: undefined,
        fixKind: lever.fix,
        actions: spec.actions,
        status: "open",
        impact: lever.impact,
        impactLabel: "GEO",
      });
    }
  }
  return issues;
}
