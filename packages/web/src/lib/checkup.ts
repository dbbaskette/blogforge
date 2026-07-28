/**
 * Checkup — the one-run overview that folds the three analysis passes
 * (Review/lint, GEO, Shape) into a single prioritized summary, so the writer
 * gets "how's my draft?" in one action instead of opening three panels and
 * merging the results in their head. The detail panels remain the place to
 * apply fixes; Checkup is the front door and the triage.
 */
import type { LintFinding } from "../api/drafts";
import type { GeoReport } from "../api/geo";
import type { HumanizeReport } from "../api/humanize";
import type { SuggestResult } from "../api/suggest";

export type CheckupKey = "review" | "geo" | "shape" | "humanize";
export type Severity = "good" | "warn" | "bad";

export interface CheckupRow {
  key: CheckupKey;
  label: string;
  count: number;
  detail: string;
  severity: Severity;
}

export interface CheckupSummary {
  headline: string;
  rows: CheckupRow[];
  totalOpen: number;
}

export interface LintResult {
  violations: LintFinding[];
  hits: LintFinding[];
  repetitions: LintFinding[];
}

function geoSeverity(grade?: string): Severity {
  if (!grade) return "warn";
  if (grade === "A" || grade === "B") return "good";
  if (grade === "C") return "warn";
  return "bad";
}

function countGeoFixes(geo: GeoReport): number {
  return geo.levers.reduce((n, l) => n + l.findings.length, 0);
}

function countShape(shape: SuggestResult): number {
  return Object.values(shape).reduce((n, arr) => n + (arr?.length ?? 0), 0);
}

function countHumanizeFindings(humanize: HumanizeReport): number {
  return humanize.lenses.reduce((n, l) => n + l.findings.length, 0);
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Fold the three raw pass results into a prioritized summary. Mechanical
 * voice-rule issues rank first (they're the anti-AI-tell red lines), then
 * structure (GEO), then optional suggestions (Shape).
 */
export function summarizeCheckup(
  lint: LintResult | null,
  geo: GeoReport | null,
  shape: SuggestResult | null,
  humanize: HumanizeReport | null,
): CheckupSummary {
  const reviewOpen = lint ? lint.violations.length + lint.repetitions.length : 0;

  const geoFixes = geo ? countGeoFixes(geo) : 0;
  const shapeCount = shape ? countShape(shape) : 0;
  const humanizeCount = humanize ? countHumanizeFindings(humanize) : 0;
  const humanizeLenses = humanize
    ? `${humanize.lenses.length} ${humanize.lenses.length === 1 ? "lens" : "lenses"}`
    : "";

  const rows: CheckupRow[] = [
    {
      key: "review",
      label: "Proofread",
      count: reviewOpen,
      detail: reviewOpen === 0 ? "No voice-rule issues" : plural(reviewOpen, "voice-rule issue"),
      severity: reviewOpen > 0 ? "bad" : "good",
    },
    {
      key: "geo",
      label: "GEO readiness",
      count: geoFixes,
      detail: geo
        ? `Grade ${geo.grade} · ${geoFixes} ${geoFixes === 1 ? "fix" : "fixes"}`
        : "Not scored yet",
      severity: geoSeverity(geo?.grade),
    },
    {
      key: "shape",
      label: "Suggestions",
      count: shapeCount,
      detail: shapeCount === 0 ? "Nothing flagged" : plural(shapeCount, "suggestion"),
      severity: shapeCount > 0 ? "warn" : "good",
    },
    {
      key: "humanize",
      label: "Humanization",
      count: humanizeCount,
      detail: humanize
        ? humanizeCount === 0
          ? `No suggestions across ${humanizeLenses}`
          : `${plural(humanizeCount, "suggestion")} across ${humanizeLenses}`
        : "Humanize review unavailable",
      severity: humanize ? (humanizeCount === 0 ? "good" : "warn") : "warn",
    },
  ];

  const totalOpen = reviewOpen + geoFixes + shapeCount;
  let headline: string;
  if (reviewOpen > 0) {
    headline = "Needs a cleanup pass";
  } else if (geo && geoSeverity(geo.grade) === "bad") {
    headline = "Structure needs work";
  } else if (totalOpen === 0) {
    headline = "Looks clean — ready to publish";
  } else {
    headline = "Almost ready — a few tweaks left";
  }

  return { headline, rows, totalOpen };
}
