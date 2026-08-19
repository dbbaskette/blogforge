import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Draft, checkClaims, lintDraft } from "../../api/drafts";
import { type GeoReport, analyzeGeo } from "../../api/geo";
import { type HumanizeReport, analyzeHumanize } from "../../api/humanize";
import { listReferences } from "../../api/references";
import { type SuggestResult, suggestImprovements } from "../../api/suggest";
import {
  analysisHashUsesContent,
  combineAnalysisHash,
  getCached,
  hashDraftContent,
  hashReferenceFingerprint,
  peekCached,
  setCached,
} from "../../lib/panelCache";
import {
  type FactualSupportResult,
  type LintResult,
  type ReviewCheck,
  type ReviewKey,
  type ReviewRow,
  type ReviewSeverity,
  type ReviewSummary,
  isCurrentReviewSummary,
  markReferenceSensitiveReviewStale,
  markReviewStale,
  summarizeReview,
} from "../../lib/reviewCenter";
import { ErrorNotice } from "../ui/ErrorNotice";
import { Icon } from "../ui/Icon";
import { useDialogA11y } from "../ui/useDialogA11y";

const REVIEW_KEYS: ReviewKey[] = ["proofread", "factual-support", "shape", "humanization", "geo"];

const inFlightChecks = new Map<string, Promise<unknown>>();

function joinInFlight<T>(key: string, start: () => Promise<T>): Promise<T> {
  const existing = inFlightChecks.get(key);
  if (existing) return existing as Promise<T>;
  const request = start().finally(() => {
    if (inFlightChecks.get(key) === request) inFlightChecks.delete(key);
  });
  inFlightChecks.set(key, request);
  return request;
}

const STATUS_LABEL: Record<ReviewRow["status"], string> = {
  running: "Running",
  current: "Current",
  stale: "Stale",
  failed: "Failed",
  unavailable: "Unavailable",
};

const SEVERITY: Record<ReviewSeverity, { dot: string; text: string }> = {
  good: { dot: "#15a06b", text: "text-green-ink" },
  warn: { dot: "#f59e0b", text: "text-amber-ink" },
  bad: { dot: "#e6492d", text: "text-coral-ink" },
  neutral: { dot: "#718096", text: "text-muted" },
};

type OpenCheck = (sectionId?: string) => void;
type OpenFactualSupport = (sectionId?: string, result?: FactualSupportResult) => void;

interface ReviewIdentity {
  draftId: string;
  contentHash: string;
  analysisHash: string | null;
  referenceCount: number | null;
  generation: number;
}

interface ReviewRunOwner {
  identity: ReviewIdentity;
  sequence: number;
}

export interface ReviewCenterProps {
  draft: Draft;
  onOpenProofread: OpenCheck;
  onOpenFactualSupport?: OpenFactualSupport;
  onOpenShape: OpenCheck;
  onOpenHumanization: OpenCheck;
  onOpenGeo: OpenCheck;
  onOpenHeadlines: () => void;
  onClose: () => void;
}

function initialResults(): {
  proofread: ReviewCheck<LintResult>;
  factualSupport: ReviewCheck<FactualSupportResult>;
  shape: ReviewCheck<SuggestResult>;
  humanization: ReviewCheck<HumanizeReport>;
  geo: ReviewCheck<GeoReport>;
} {
  return {
    proofread: { status: "running" },
    factualSupport: { status: "running" },
    shape: { status: "running" },
    humanization: { status: "running" },
    geo: { status: "running" },
  };
}

function unavailableResults() {
  const unavailable = { status: "unavailable" as const, detail: "Not run yet." };
  return {
    proofread: unavailable,
    factualSupport: unavailable,
    shape: unavailable,
    humanization: unavailable,
    geo: unavailable,
  };
}

function rowFor(key: ReviewKey, check: ReviewCheck<unknown>): ReviewRow {
  const empty = unavailableResults();
  switch (key) {
    case "proofread":
      return summarizeReview({
        ...empty,
        proofread: check as ReviewCheck<LintResult>,
      }).rows[0];
    case "factual-support":
      return summarizeReview({
        ...empty,
        factualSupport: check as ReviewCheck<FactualSupportResult>,
      }).rows[1];
    case "shape":
      return summarizeReview({
        ...empty,
        shape: check as ReviewCheck<SuggestResult>,
      }).rows[2];
    case "humanization":
      return summarizeReview({
        ...empty,
        humanization: check as ReviewCheck<HumanizeReport>,
      }).rows[3];
    case "geo":
      return summarizeReview({
        ...empty,
        geo: check as ReviewCheck<GeoReport>,
      }).rows[4];
  }
}

function replaceRows(
  summary: ReviewSummary,
  replacements: Map<ReviewKey, ReviewRow>,
): ReviewSummary {
  const rows = summary.rows.map((row) => replacements.get(row.key) ?? row);
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
  return { ...summary, rows, totalOpen, headline };
}

export function ReviewCenter({
  draft,
  onOpenProofread,
  onOpenFactualSupport,
  onOpenShape,
  onOpenHumanization,
  onOpenGeo,
  onOpenHeadlines,
  onClose,
}: ReviewCenterProps): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const hash = useMemo(() => hashDraftContent(draft), [draft]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const summaryRef = useRef<ReviewSummary | null>(null);
  const [runningKeys, setRunningKeys] = useState<Set<ReviewKey>>(new Set());
  const runningKeysRef = useRef<Set<ReviewKey>>(new Set());
  const factualSupportRef = useRef<FactualSupportResult | null>(null);
  const mountedRef = useRef(false);
  const runSequenceRef = useRef(0);
  const identityRef = useRef<ReviewIdentity>({
    draftId: draft.id,
    contentHash: hash,
    analysisHash: null,
    referenceCount: null,
    generation: 0,
  });

  if (identityRef.current.draftId !== draft.id || identityRef.current.contentHash !== hash) {
    identityRef.current = {
      draftId: draft.id,
      contentHash: hash,
      analysisHash: null,
      referenceCount: null,
      generation: identityRef.current.generation + 1,
    };
    runSequenceRef.current += 1;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runSequenceRef.current += 1;
      identityRef.current = {
        ...identityRef.current,
        generation: identityRef.current.generation + 1,
      };
    };
  }, []);

  const ownsIdentity = useCallback(
    (identity: ReviewIdentity): boolean => mountedRef.current && identityRef.current === identity,
    [],
  );

  const ownsRun = useCallback(
    (owner: ReviewRunOwner): boolean =>
      ownsIdentity(owner.identity) && runSequenceRef.current === owner.sequence,
    [ownsIdentity],
  );

  const updateSummary = useCallback(
    (
      owner: ReviewRunOwner,
      updater: (previous: ReviewSummary | null) => ReviewSummary,
    ): ReviewSummary | null => {
      if (!ownsRun(owner)) return null;
      const next = updater(summaryRef.current);
      summaryRef.current = next;
      setSummary(next);
      return next;
    },
    [ownsRun],
  );

  const executeCheck = useCallback(
    async (
      identity: ReviewIdentity,
      key: ReviewKey,
      bypassCache: boolean,
    ): Promise<ReviewCheck<unknown>> => {
      try {
        const requestKey = `${identity.draftId}\u0000${
          identity.analysisHash ??
          `${identity.contentHash}:references-${identity.referenceCount ?? "unknown"}`
        }\u0000${key}`;
        switch (key) {
          case "proofread":
            return {
              status: "current",
              data: await joinInFlight(requestKey, () => lintDraft(identity.draftId)),
            };
          case "factual-support": {
            if (identity.referenceCount === 0) {
              return {
                status: "current",
                data: { claims: [], has_references: false },
              };
            }
            const hit =
              bypassCache || !identity.analysisHash
                ? null
                : getCached<FactualSupportResult>(
                    "factual-support",
                    identity.draftId,
                    identity.analysisHash,
                  );
            if (hit) return { status: "current", data: hit.data };
            return {
              status: "current",
              data: await joinInFlight(requestKey, () => checkClaims(identity.draftId)),
            };
          }
          case "shape": {
            const hit = bypassCache
              ? null
              : getCached<SuggestResult>("shape", identity.draftId, identity.contentHash);
            if (hit) return { status: "current", data: hit.data };
            const data = await joinInFlight(requestKey, () =>
              suggestImprovements(identity.draftId),
            );
            return { status: "current", data };
          }
          case "humanization": {
            const cacheHash = `${identity.contentHash}:medium`;
            const hit = bypassCache
              ? null
              : getCached<HumanizeReport>("humanize", identity.draftId, cacheHash);
            if (hit) return { status: "current", data: hit.data };
            const data = await joinInFlight(requestKey, () =>
              analyzeHumanize(identity.draftId, "medium"),
            );
            return { status: "current", data };
          }
          case "geo": {
            const hit =
              bypassCache || !identity.analysisHash
                ? null
                : getCached<GeoReport>("geo", identity.draftId, identity.analysisHash);
            if (hit) return { status: "current", data: hit.data };
            const data = await joinInFlight(requestKey, () => analyzeGeo(identity.draftId));
            return { status: "current", data };
          }
        }
      } catch (error) {
        return { status: "failed", error };
      }
    },
    [],
  );

  const run = useCallback(
    async (
      keys: ReviewKey[] = REVIEW_KEYS,
      bypassCache = false,
      identity: ReviewIdentity = identityRef.current,
    ): Promise<void> => {
      if (!ownsIdentity(identity)) return;
      const owner = { identity, sequence: ++runSequenceRef.current };
      const nextRunning = new Set([...runningKeysRef.current, ...keys]);
      runningKeysRef.current = nextRunning;
      setRunningKeys(nextRunning);
      const runningRows = new Map(
        keys.map((key) => [key, rowFor(key, { status: "running" })] as const),
      );
      updateSummary(owner, (previous) =>
        previous ? replaceRows(previous, runningRows) : summarizeReview(initialResults()),
      );

      await Promise.all(
        keys.map(async (key) => {
          const result = await executeCheck(identity, key, bypassCache);
          if (!ownsRun(owner)) return;
          if (result.status === "current") {
            if (key === "shape") {
              setCached("shape", identity.draftId, identity.contentHash, result.data);
            } else if (key === "humanization") {
              setCached(
                "humanize",
                identity.draftId,
                `${identity.contentHash}:medium`,
                result.data,
              );
            } else if (key === "geo" && identity.analysisHash) {
              setCached("geo", identity.draftId, identity.analysisHash, result.data);
            } else if (key === "factual-support") {
              const factual = result.data as FactualSupportResult;
              factualSupportRef.current = factual;
              if (identity.analysisHash) {
                setCached("factual-support", identity.draftId, identity.analysisHash, factual);
              }
            }
          }
          const replacement = new Map([[key, rowFor(key, result)]]);
          updateSummary(owner, (previous) =>
            replaceRows(previous ?? summarizeReview(initialResults()), replacement),
          );
          if (!ownsRun(owner)) return;
          const next = new Set(runningKeysRef.current);
          next.delete(key);
          runningKeysRef.current = next;
          setRunningKeys(next);
        }),
      );

      if (!ownsRun(owner)) return;
      const finished = summaryRef.current;
      if (finished && identity.analysisHash) {
        setCached("review-center", identity.draftId, identity.analysisHash, finished);
      }
    },
    [executeCheck, ownsIdentity, ownsRun, updateSummary],
  );

  useEffect(() => {
    const identity = identityRef.current;
    if (identity.draftId !== draft.id || identity.contentHash !== hash) return;
    let cancelled = false;
    runSequenceRef.current += 1;
    summaryRef.current = null;
    factualSupportRef.current = null;
    runningKeysRef.current = new Set();
    setSummary(null);
    setRunningKeys(new Set());

    const stillOwned = (): boolean => !cancelled && ownsIdentity(identity);
    void listReferences(identity.draftId)
      .then((references) => {
        if (!stillOwned()) return;
        const referenceHash = hashReferenceFingerprint(references);
        const analysisHash = combineAnalysisHash(identity.contentHash, referenceHash);
        identity.analysisHash = analysisHash;
        identity.referenceCount = references.length;
        const saved = peekCached<ReviewSummary>("review-center", identity.draftId);
        if (saved && isCurrentReviewSummary(saved.data)) {
          const restored =
            saved.hash === analysisHash
              ? saved.data
              : analysisHashUsesContent(saved.hash, identity.contentHash)
                ? markReferenceSensitiveReviewStale(saved.data)
                : markReviewStale(saved.data);
          if (!stillOwned()) return;
          factualSupportRef.current =
            getCached<FactualSupportResult>("factual-support", identity.draftId, analysisHash)
              ?.data ?? null;
          summaryRef.current = restored;
          setSummary(restored);
          return;
        }
        void run(REVIEW_KEYS, false, identity);
      })
      .catch(() => {
        if (!stillOwned()) return;
        identity.analysisHash = null;
        identity.referenceCount = null;
        void run(REVIEW_KEYS, false, identity);
      });
    return () => {
      cancelled = true;
      runSequenceRef.current += 1;
    };
  }, [draft.id, hash, ownsIdentity, run]);

  const open: Record<Exclude<ReviewKey, "factual-support">, OpenCheck> = {
    proofread: onOpenProofread,
    shape: onOpenShape,
    humanization: onOpenHumanization,
    geo: onOpenGeo,
  };
  const openCheck = (key: ReviewKey, sectionId?: string): void => {
    if (key === "factual-support") {
      if (onOpenFactualSupport) {
        onOpenFactualSupport(sectionId, factualSupportRef.current ?? undefined);
      } else {
        onOpenProofread(sectionId);
      }
      return;
    }
    open[key](sectionId);
  };
  const failedKeys =
    summary?.rows.filter((row) => row.status === "failed").map((row) => row.key) ?? [];
  const isBusy = runningKeys.size > 0;

  return (
    <div
      ref={panelRef}
      // biome-ignore lint/a11y/useSemanticElements: shared slide-in modal panel behavior
      role="dialog"
      aria-modal="true"
      aria-label="Review Center"
      className="fixed right-0 top-0 z-30 h-full w-[440px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
    >
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            Review Center
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void run(failedKeys.length > 0 ? failedKeys : REVIEW_KEYS, true)}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={isBusy}
            >
              {isBusy ? "Running..." : failedKeys.length > 0 ? "Retry failed checks" : "Re-run"}
            </button>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              <Icon name="x" size={16} title="" />
            </button>
          </div>
        </div>
        <h2 className="mt-1 font-serif text-2xl font-medium text-ink tracking-tight">
          {summary?.headline ?? "Reviewing your draft..."}
        </h2>
        {summary?.rows.some((row) => row.status === "stale") && !isBusy && (
          <p className="mt-1 text-xs text-amber-ink">
            Draft changed since this review. Re-run for current results.
          </p>
        )}
        {summary && (
          <p className="mt-2 text-xs text-muted">
            {summary.totalOpen === 0 ? "No open concerns" : `${summary.totalOpen} to address`}
          </p>
        )}
      </header>

      <div className="p-6 space-y-3">
        {summary?.rows.map((row) => {
          const canOpen = row.status === "current" || row.status === "stale";
          return (
            <section
              key={row.key}
              aria-label={`${row.label} review`}
              className="glass-card p-3 space-y-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: SEVERITY[row.severity].dot }}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h3 className="text-sm font-semibold text-ink">{row.label}</h3>
                    <span className={`text-[11px] font-semibold ${SEVERITY[row.severity].text}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </div>
                  <p className={`text-xs leading-snug ${SEVERITY[row.severity].text}`}>
                    {row.detail}
                  </p>
                </div>
                {canOpen && (
                  <button
                    type="button"
                    onClick={() => openCheck(row.key, row.sectionId)}
                    className="nb-btn nb-btn-sm shrink-0"
                    aria-label={`Open ${row.label}`}
                  >
                    Open
                  </button>
                )}
              </div>
              {row.status === "failed" && (
                <ErrorNotice
                  error={row.error}
                  operation={`${row.label.toLowerCase()} review`}
                  onRetry={() => void run([row.key], true)}
                />
              )}
            </section>
          );
        })}

        <section className="mt-5 rounded-nb-sm border border-rule bg-paper-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            Creative follow-up
          </p>
          <h3 className="mt-1 font-serif text-lg font-medium text-ink">Headlines and hooks</h3>
          <p className="mt-1 text-xs text-muted">
            Explore fresh options after the quality checks are handled.
          </p>
          <button type="button" onClick={onOpenHeadlines} className="nb-btn nb-btn-sm mt-3">
            Explore headlines and hooks
          </button>
        </section>
      </div>
    </div>
  );
}
