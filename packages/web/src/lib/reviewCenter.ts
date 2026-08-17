import type { ClaimResult, LintFinding } from "../api/drafts";
import type { GeoReport } from "../api/geo";
import type { HumanizeReport } from "../api/humanize";
import type { SuggestResult } from "../api/suggest";

export const REVIEW_CENTER_CACHE_VERSION = 2;

export type ReviewKey = "proofread" | "factual-support" | "shape" | "humanization" | "geo";
export type ReviewStatus = "running" | "current" | "stale" | "failed" | "unavailable";
export type ReviewSeverity = "good" | "warn" | "bad" | "neutral";

export interface LintResult {
  violations: LintFinding[];
  hits: LintFinding[];
  repetitions: LintFinding[];
}

export interface FactualSupportResult {
  claims: ClaimResult[];
  has_references: boolean;
}

export type ReviewCheck<T> =
  | { status: "running" }
  | { status: "current" | "stale"; data: T }
  | { status: "failed"; error: unknown }
  | { status: "unavailable"; detail: string };

export interface ReviewResults {
  proofread: ReviewCheck<LintResult>;
  factualSupport: ReviewCheck<FactualSupportResult>;
  shape: ReviewCheck<SuggestResult>;
  humanization: ReviewCheck<HumanizeReport>;
  geo: ReviewCheck<GeoReport>;
}

export interface ReviewRow {
  key: ReviewKey;
  label: string;
  status: ReviewStatus;
  count: number;
  detail: string;
  severity: ReviewSeverity;
  sectionId?: string;
  error?: unknown;
}

export interface ReviewSummary {
  version: typeof REVIEW_CENTER_CACHE_VERSION;
  headline: string;
  rows: ReviewRow[];
  totalOpen: number;
}

const plural = (count: number, singular: string, pluralWord = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : pluralWord}`;

function baseRow(key: ReviewKey, label: string, check: ReviewCheck<unknown>): ReviewRow | null {
  if (check.status === "running") {
    return { key, label, status: "running", count: 0, detail: "Checking...", severity: "neutral" };
  }
  if (check.status === "failed") {
    return {
      key,
      label,
      status: "failed",
      count: 0,
      detail: "Check failed.",
      severity: "bad",
      error: check.error,
    };
  }
  if (check.status === "unavailable") {
    return {
      key,
      label,
      status: "unavailable",
      count: 0,
      detail: check.detail,
      severity: "warn",
    };
  }
  return null;
}

function completedSeverity(status: "current" | "stale", count: number, critical = false) {
  if (status === "stale") return "warn" as const;
  if (count === 0) return "good" as const;
  return critical ? ("bad" as const) : ("warn" as const);
}

function proofreadRow(check: ReviewCheck<LintResult>): ReviewRow {
  const base = baseRow("proofread", "Proofread", check);
  if (base) return base;
  const { data, status } = check as Extract<typeof check, { status: "current" | "stale" }>;
  const findings = [...data.violations, ...data.repetitions];
  const count = findings.length;
  const sectionId = findings.find((finding) => finding.section_id)?.section_id ?? undefined;
  return {
    key: "proofread",
    label: "Proofread",
    status,
    count,
    detail: count === 0 ? "No voice-rule issues" : plural(count, "voice-rule issue"),
    severity: completedSeverity(status, count, true),
    ...(sectionId ? { sectionId } : {}),
  };
}

function factualSupportRow(check: ReviewCheck<FactualSupportResult>): ReviewRow {
  const base = baseRow("factual-support", "Factual support", check);
  if (base) return base;
  const { data, status } = check as Extract<typeof check, { status: "current" | "stale" }>;
  if (!data.has_references) {
    return {
      key: "factual-support",
      label: "Factual support",
      status: "unavailable",
      count: 0,
      detail: "Attach references before checking factual support.",
      severity: "warn",
    };
  }
  const count = data.claims.filter(
    (claim) => claim.status === "unsupported" || claim.status === "contradicted",
  ).length;
  return {
    key: "factual-support",
    label: "Factual support",
    status,
    count,
    detail:
      count === 0 ? "All checked claims are supported" : `${plural(count, "claim")} need attention`,
    severity: completedSeverity(status, count, true),
  };
}

function shapeRow(check: ReviewCheck<SuggestResult>): ReviewRow {
  const base = baseRow("shape", "Shape", check);
  if (base) return base;
  const { data, status } = check as Extract<typeof check, { status: "current" | "stale" }>;
  const count = Object.values(data).reduce(
    (total, suggestions) => total + (suggestions?.length ?? 0),
    0,
  );
  return {
    key: "shape",
    label: "Shape",
    status,
    count,
    detail: count === 0 ? "Nothing flagged" : plural(count, "suggestion"),
    severity: completedSeverity(status, count),
  };
}

function humanizationRow(check: ReviewCheck<HumanizeReport>): ReviewRow {
  const base = baseRow("humanization", "Humanization", check);
  if (base) return base;
  const { data, status } = check as Extract<typeof check, { status: "current" | "stale" }>;
  const findings = data.lenses.flatMap((lens) => lens.findings);
  const count = findings.length;
  const sectionId = findings.find((finding) => finding.section_id)?.section_id;
  return {
    key: "humanization",
    label: "Humanization",
    status,
    count,
    detail: count === 0 ? "No humanization suggestions" : plural(count, "suggestion"),
    severity: completedSeverity(status, count),
    ...(sectionId ? { sectionId } : {}),
  };
}

function geoRow(check: ReviewCheck<GeoReport>): ReviewRow {
  const base = baseRow("geo", "GEO readiness", check);
  if (base) return base;
  const { data, status } = check as Extract<typeof check, { status: "current" | "stale" }>;
  const findings = data.levers.flatMap((lever) => lever.findings);
  const count = findings.length;
  const sectionId = findings.find((finding) => finding.section_id)?.section_id;
  const gradeNeedsAttention = !["A", "B", "C"].includes(data.grade);
  return {
    key: "geo",
    label: "GEO readiness",
    status,
    count,
    detail: `Grade ${data.grade}, ${plural(count, "fix", "fixes")}`,
    severity:
      status === "stale" ? "warn" : gradeNeedsAttention ? "bad" : completedSeverity(status, count),
    ...(sectionId ? { sectionId } : {}),
  };
}

export function summarizeReview(results: ReviewResults): ReviewSummary {
  const rows = [
    proofreadRow(results.proofread),
    factualSupportRow(results.factualSupport),
    shapeRow(results.shape),
    humanizationRow(results.humanization),
    geoRow(results.geo),
  ];
  const totalOpen = rows.reduce((total, row) => total + row.count, 0);
  const headline = rows.some((row) => row.status === "running")
    ? "Reviewing your draft..."
    : rows.some((row) => row.status === "failed")
      ? "Review complete with gaps"
      : rows.some((row) => row.status === "stale")
        ? "Review results need a refresh"
        : rows.some((row) => row.severity === "bad")
          ? "Review needs attention"
          : totalOpen === 0
            ? "Review complete"
            : "A few improvements remain";

  return { version: REVIEW_CENTER_CACHE_VERSION, headline, rows, totalOpen };
}

export function markReviewStale(summary: ReviewSummary): ReviewSummary {
  return {
    ...summary,
    headline: "Review results need a refresh",
    rows: summary.rows.map((row) =>
      row.status === "current" ? { ...row, status: "stale", severity: "warn" } : row,
    ),
  };
}

/** Reference changes invalidate only checks whose answers depend on sources.
 * An unavailable factual-support result becomes stale because newly attached
 * references may now make the check available. */
export function markReferenceSensitiveReviewStale(summary: ReviewSummary): ReviewSummary {
  return {
    ...summary,
    headline: "Review results need a refresh",
    rows: summary.rows.map((row) => {
      if (row.key !== "factual-support" && row.key !== "geo") return row;
      if (row.status === "failed" || row.status === "running") return row;
      return {
        ...row,
        status: "stale",
        severity: "warn",
        detail:
          row.key === "factual-support"
            ? "References changed. Re-run factual support."
            : row.detail,
      };
    }),
  };
}

export function isCurrentReviewSummary(value: unknown): value is ReviewSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReviewSummary>;
  if (candidate.version !== REVIEW_CENTER_CACHE_VERSION || !Array.isArray(candidate.rows)) {
    return false;
  }
  const keys: ReviewKey[] = ["proofread", "factual-support", "shape", "humanization", "geo"];
  return (
    candidate.rows.length === keys.length && candidate.rows.every((row, i) => row.key === keys[i])
  );
}
