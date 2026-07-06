/**
 * Two-pane Optimize mode. Replaces the old cramped right-side GEO drawer with a
 * full-width shell: the draft on the LEFT (readable, scrollable), the GEO issue
 * rail on the RIGHT (~42%, roomy), a slim header on top. The app's nav rail is
 * "collapsed" simply by covering it with this overlay.
 *
 * The analyze + targeted-per-lever-rescore logic is the same as GeoPanel's
 * (which now only survives for its exported pure helpers): analyze on mount,
 * debounce a burst of fixes into one rescore call, merge the returned levers
 * back in and recompute the overall score from present-weighted levers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Draft, lintDraft } from "../../api/drafts";
import { type GeoReport, analyzeGeo, rescoreGeo } from "../../api/geo";
import { geoFindingsToIssues } from "../../lib/issues/geoAdapter";
import { type LintResult, proofreadFindingsToIssues } from "../../lib/issues/proofreadAdapter";
import { getCached, hashDraftContent, setCached } from "../../lib/panelCache";
import { HighlightedText } from "../review/HighlightedText";
import { BusyOverlay } from "../ui/BusyOverlay";
import { InlineMarkdown } from "../ui/InlineMarkdown";
import { useDialogA11y } from "../ui/useDialogA11y";
import { GeoReviewRail } from "./GeoReviewRail";
import { ProofreadReviewRail } from "./ProofreadReviewRail";
import { computeTotalScore } from "./geoScore";
import type { TrackedChangeKind } from "./trackedChangeDecoration";

type ReviewView = "seo" | "proofreading" | "all";

// A visible box around the section a fix/Highlight targets, so there's always
// clear feedback even when the exact run can't be located for an inline mark.
const LIT_BOX = "rounded-nb ring-2 ring-amber/60 bg-amber-soft px-3 -mx-3 py-2";

function gradeColor(grade: string): { bg: string; fg: string; bd: string } {
  if (grade === "A" || grade === "B") return { bg: "#e3f5ec", fg: "#0e7a50", bd: "#bfe8d3" };
  if (grade === "C") return { bg: "#fbf1de", fg: "#92600a", bd: "#f3d89b" };
  return { bg: "#fde7e2", fg: "#b5321b", bd: "#f7c3b6" };
}

/** Grade thresholds mirror the backend's _grade — used to recompute the letter
 * grade after a targeted per-lever re-score merges new scores in. */
function localGrade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 72) return "B";
  if (score >= 58) return "C";
  if (score >= 45) return "D";
  return "F";
}

export interface OptimizePanelProps {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onChange: (next: Draft) => Promise<void>;
  onClose: () => void;
}

export function OptimizePanel({
  draft,
  onSectionSave,
  onChange,
  onClose,
}: OptimizePanelProps): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [report, setReport] = useState<GeoReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while a targeted per-lever re-score is in flight after a fix.
  const [rescoring, setRescoring] = useState(false);
  // Segmented review view + lazily-loaded Proofreader findings.
  const [view, setView] = useState<ReviewView>("seo");
  const [lint, setLint] = useState<LintResult | null>(null);
  const [lintBusy, setLintBusy] = useState(false);
  // Which passage is lit in the read pane: an applied fix awaiting accept
  // ("under-review"), or a transient "locate" from the Highlight action.
  const [highlight, setHighlight] = useState<{
    sectionId: string;
    text: string;
    kind: TrackedChangeKind;
  } | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const locateTimer = useRef<number | null>(null);

  const onHighlight = useCallback(
    (sectionId: string, text: string | null, kind: "under-review" | "locate"): void => {
      if (locateTimer.current) window.clearTimeout(locateTimer.current);
      if (!text) {
        setHighlight(null);
        return;
      }
      setHighlight({ sectionId, text, kind });
      // Locate is transient; an under-review highlight persists until accept/undo.
      if (kind === "locate") {
        locateTimer.current = window.setTimeout(() => setHighlight(null), 2600);
      }
    },
    [],
  );

  // Scroll the lit passage into view whenever the highlight changes.
  useEffect(() => {
    if (highlight) {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  const contentHash = useMemo(() => hashDraftContent(draft), [draft]);

  // Load the Proofreader findings on demand the first time the view needs them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when proofreading first shown
  useEffect(() => {
    if (view === "seo" || lint || lintBusy) return;
    setLintBusy(true);
    lintDraft(draft.id)
      .then(setLint)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLintBusy(false));
  }, [view]);

  const run = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const h = hashDraftContent(draft);
      const fresh = await analyzeGeo(draft.id);
      setReport(fresh);
      setCached("geo", draft.id, h, fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  // On open: show the last result instantly if the draft hasn't changed since;
  // otherwise run a fresh scan.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    const hit = getCached<GeoReport>("geo", draft.id, contentHash);
    if (hit) {
      setReport(hit.data);
    } else {
      run();
    }
  }, []);

  // ── Targeted re-score: after a fix, re-score ONLY the affected lever(s) and
  // merge them back in, recomputing the total from each lever's weight. Other
  // levers are never re-run. Debounced so a burst of fixes coalesces. ──
  const pendingRescore = useRef<Set<string>>(new Set());
  const rescoreTimer = useRef<number | null>(null);

  const flushRescore = useCallback(async (): Promise<void> => {
    const keys = [...pendingRescore.current].filter(Boolean);
    pendingRescore.current = new Set();
    if (keys.length === 0) return;
    setRescoring(true);
    try {
      const fresh = await rescoreGeo(draft.id, keys);
      setReport((prev) => {
        if (!prev) return prev;
        const levers = prev.levers.map((l) => fresh[l.key] ?? l);
        const score = computeTotalScore(levers);
        return { ...prev, levers, score, grade: localGrade(score) };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRescoring(false);
    }
  }, [draft.id]);

  const queueRescore = useCallback(
    (leverKey: string): void => {
      if (!leverKey) return;
      pendingRescore.current.add(leverKey);
      if (rescoreTimer.current) window.clearTimeout(rescoreTimer.current);
      rescoreTimer.current = window.setTimeout(() => void flushRescore(), 900);
    },
    [flushRescore],
  );

  // The opening/lede is a first-class field (outline.opening_hook), scored as
  // the article's true opening — opener fixes operate on IT, not the first
  // section. The rail persists opener fixes through this callback.
  const saveOpening = useCallback(
    async (opening_hook: string): Promise<void> => {
      const outline = draft.outline ?? { opening_hook: "", sections: [], estimated_words: 0 };
      await onChange({ ...draft, outline: { ...outline, opening_hook } });
    },
    [draft, onChange],
  );

  // A section's heading lives on both the section and the outline; keep them in
  // sync when a question-heading fix rewrites the title.
  const saveTitle = useCallback(
    async (sectionId: string, title: string): Promise<void> => {
      const sections = draft.sections.map((s) => (s.id === sectionId ? { ...s, title } : s));
      const outline = draft.outline
        ? {
            ...draft.outline,
            sections: draft.outline.sections.map((s) => (s.id === sectionId ? { ...s, title } : s)),
          }
        : draft.outline;
      await onChange({ ...draft, sections, outline });
    },
    [draft, onChange],
  );

  const geoCount = useMemo(() => (report ? geoFindingsToIssues(report).length : 0), [report]);
  const lintCount = useMemo(() => (lint ? proofreadFindingsToIssues(lint).length : 0), [lint]);
  const totalIssues =
    view === "seo" ? geoCount : view === "proofreading" ? lintCount : geoCount + lintCount;
  const grade = report ? gradeColor(report.grade) : gradeColor("F");
  const opening = draft.outline?.opening_hook?.trim() ?? "";

  return (
    <div
      ref={panelRef}
      // biome-ignore lint/a11y/useSemanticElements: a full-screen mode overlay, not a native <dialog>; matches the app's other panels (GeoPanel/LintPanel/ShapePanel)
      role="dialog"
      aria-modal="true"
      aria-label="Optimize"
      className="fixed inset-0 z-40 flex flex-col bg-canvas overflow-hidden"
    >
      {rescoring && <BusyOverlay label="Re-scoring the changed lever…" />}

      {/* Slim header */}
      <header className="shrink-0 glass-bar border-b border-rule px-4 lg:px-6 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="nb-btn nb-btn-ghost nb-btn-sm"
            aria-label="Done"
          >
            ← Done
          </button>
          <h1 className="text-base font-semibold text-ink">Optimize</h1>
          <div className="flex gap-0.5 rounded-nb-sm bg-canvas p-0.5 text-xs" role="tablist">
            {(["seo", "proofreading", "all"] as ReviewView[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 rounded-[6px] ${
                  view === v
                    ? "bg-card text-ink font-medium shadow-nb"
                    : "text-muted hover:text-ink"
                }`}
              >
                {v === "seo" ? "SEO" : v === "proofreading" ? "Proofreading" : "All"}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted tabular-nums">{`${totalIssues} issues`}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={run}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={busy}
            >
              {busy ? "Analyzing…" : "Re-analyze"}
            </button>
            <div
              className="flex items-center gap-1.5 rounded-nb-sm px-2.5 py-1"
              style={{ background: grade.bg, border: `1px solid ${grade.bd}`, color: grade.fg }}
              title="Overall GEO readiness score"
            >
              <span className="text-lg font-bold leading-none tabular-nums">
                {report?.score ?? "—"}
              </span>
              <span className="text-xs font-semibold">{report?.grade ?? "—"}</span>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div
          className="mx-4 lg:mx-6 mt-4 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          {error}
        </div>
      )}

      {/* Two-column body: draft on the left, issue rail on the right. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left pane — read view of the draft */}
        <div className="flex-1 min-w-0 overflow-y-auto px-4 lg:px-8 py-6">
          <div className="max-w-2xl mx-auto">
            <h2 className="font-serif text-2xl md:text-3xl font-medium text-ink leading-tight tracking-tight mb-6">
              {draft.title.trim() ? (
                <InlineMarkdown text={draft.title} />
              ) : (
                <span className="text-muted-2">Untitled draft</span>
              )}
            </h2>

            {opening && (
              <p
                ref={highlight?.sectionId === "opening" ? highlightRef : undefined}
                className={`text-ink leading-relaxed whitespace-pre-wrap mb-8 ${
                  highlight?.sectionId === "opening" ? LIT_BOX : ""
                }`}
              >
                <HighlightedText
                  text={opening}
                  mark={highlight?.sectionId === "opening" ? highlight.text : null}
                  kind={highlight?.kind}
                />
              </p>
            )}

            <div className="space-y-8">
              {draft.sections.map((section) => {
                const lit = highlight?.sectionId === section.id ? highlight : null;
                return (
                  <section key={section.id}>
                    {section.title.trim() && (
                      <h3 className="font-serif text-xl font-medium text-ink mb-3">
                        {section.title}
                      </h3>
                    )}
                    <div
                      ref={lit ? highlightRef : undefined}
                      className={`prose text-ink leading-relaxed whitespace-pre-wrap ${
                        lit ? LIT_BOX : ""
                      }`}
                    >
                      {section.content_md?.trim() ? (
                        <HighlightedText
                          text={section.content_md}
                          mark={lit?.text ?? null}
                          kind={lit?.kind}
                        />
                      ) : (
                        <span className="text-muted-2 not-italic">No content yet.</span>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right pane — the GEO issue rail */}
        <aside className="w-full lg:w-[42%] lg:max-w-[560px] shrink-0 border-t lg:border-t-0 lg:border-l border-rule bg-card/40 overflow-y-auto px-4 lg:px-5 py-6">
          {(view === "seo" || view === "all") && (
            <div className="space-y-3">
              {view === "all" && (
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">SEO</h2>
              )}
              {busy && !report && (
                <p className="py-10 text-center text-sm text-muted">Scoring your draft…</p>
              )}
              {rescoring && !busy && (
                <div className="mb-4 px-3 py-2 rounded-nb-sm text-sm bg-cobalt-50 text-cobalt-800">
                  Re-scoring the changed lever…
                </div>
              )}
              {report && (
                <GeoReviewRail
                  report={report}
                  draft={draft}
                  onSectionSave={onSectionSave}
                  onOpeningSave={saveOpening}
                  onTitleSave={saveTitle}
                  onRescore={queueRescore}
                  onHighlight={onHighlight}
                />
              )}
            </div>
          )}

          {(view === "proofreading" || view === "all") && (
            <div className={view === "all" ? "mt-6 space-y-3" : "space-y-3"}>
              {view === "all" && (
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Proofreading
                </h2>
              )}
              {lintBusy && !lint && (
                <p className="py-10 text-center text-sm text-muted">Proofreading…</p>
              )}
              {lint && (
                <ProofreadReviewRail
                  lint={lint}
                  draft={draft}
                  onSectionSave={onSectionSave}
                  onHighlight={onHighlight}
                />
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
