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
  /** 0-100 blended "reads human" score (anti-robot + human-signal). */
  humanity: number;
  /** The two sub-scores behind `humanity`, so the meter can show the split. */
  antiRobot: number;
  humanSignal: number | null;
  rows: CheckupRow[];
  totalOpen: number;
}

export interface LintResult {
  violations: LintFinding[];
  hits: LintFinding[];
  repetitions: LintFinding[];
}

/** Mirrors LintPanel's humanity score so Checkup and the panel agree. */
export function humanityScore(openCount: number, hitCount: number): number {
  const base = 100 - openCount * 6;
  const bonus = openCount === 0 ? 0 : Math.min(hitCount * 2, 10);
  return Math.max(0, Math.min(100, base + bonus));
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

/** coral (low) → amber (mid) → leaf/green (high); mirrors LintPanel/HumannessPulse's scoreColor. */
function humanizeSeverity(score?: number): Severity {
  if (score === undefined) return "warn";
  if (score >= 70) return "good";
  if (score >= 45) return "warn";
  return "bad";
}

function countHumanizeFindings(humanize: HumanizeReport): number {
  return humanize.lenses.reduce((n, l) => n + l.findings.length, 0);
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

const W_ROBOT = 0.5;
const W_HUMAN = 0.5;

/** One "Reads X% human" number from the anti-robot lint sub-score and the
 * (optional, until Humanize has run) human-signal sub-score. */
export function blendHumanness(antiRobot: number, humanSignal: number | null): number {
  if (humanSignal == null) return Math.max(0, Math.min(100, Math.round(antiRobot)));
  return Math.max(0, Math.min(100, Math.round(W_ROBOT * antiRobot + W_HUMAN * humanSignal)));
}

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
  const hits = lint ? lint.hits.length : 0;
  const antiRobot = humanityScore(reviewOpen, hits);
  const humanSignal = humanize ? humanize.score : null;
  const humanity = blendHumanness(antiRobot, humanSignal);

  const geoFixes = geo ? countGeoFixes(geo) : 0;
  const shapeCount = shape ? countShape(shape) : 0;
  const humanizeCount = humanize ? countHumanizeFindings(humanize) : 0;

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
      label: "Humanness",
      count: humanizeCount,
      detail: humanize
        ? `${humanize.score}% human signal · ${plural(humanizeCount, "finding")}`
        : "Not scored yet",
      severity: humanizeSeverity(humanize?.score),
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

  return { headline, humanity, antiRobot, humanSignal, rows, totalOpen };
}
