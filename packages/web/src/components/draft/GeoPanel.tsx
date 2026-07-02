import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Draft } from "../../api/drafts";
import { type GeoReport, analyzeGeo, geoQueries, rescoreGeo } from "../../api/geo";
import { formatAgo, getCached, hashDraftContent, setCached } from "../../lib/panelCache";
import { BusyOverlay } from "../ui/BusyOverlay";
import { useDialogA11y } from "../ui/useDialogA11y";
import { GeoReviewRail } from "./GeoReviewRail";

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

/** Each lever's share of the total, mirroring the backend's _WEIGHTS. Kept here
 * (rather than trusting lever.weight) so the total still recomputes correctly
 * even for a report cached by an older bundle whose levers lack `weight`. */
const LEVER_WEIGHTS: Record<string, number> = {
  answer_first: 0.16,
  factual_density: 0.16,
  citations: 0.1,
  definitional_opener: 0.08,
  question_headings: 0.08,
  skimmability: 0.08,
  brand_explicit: 0.06,
  faq: 0.06,
  chunking: 0.06,
  takeaways: 0.06,
  freshness: 0.06,
  comparison_table: 0.04,
};

/** Weighted overall score (0-100) from the current levers, normalized by the
 * weights of the levers actually present — matching the backend's build_report,
 * so a partial report (or one from a bundle mid-rollout) isn't diluted by a
 * missing lever's weight. Pure; exported for tests. */
export function computeTotalScore(
  levers: { key: string; score: number; weight?: number }[],
): number {
  let weighted = 0;
  let wsum = 0;
  for (const l of levers) {
    const w = LEVER_WEIGHTS[l.key] ?? l.weight ?? 0;
    weighted += l.score * w;
    wsum += w;
  }
  return wsum > 0 ? Math.round(weighted / wsum) : 0;
}

// ── Persistent record of GEO-added content (opener / FAQ), per draft. Kept as
// exported pure helpers for the unit tests that pin their carve/dedupe logic;
// the "protected additions" survive-later-rewrites behaviour is a known
// follow-up now that fixes run through the unified issue-card rail. ──
export interface Addition {
  sectionId: string;
  text: string;
  /** A duplicated-title heading the opener fix moved out of the way; restored
   * verbatim by Remove. */
  removed?: string;
}
export interface Additions {
  opener?: Addition;
  faq?: Addition;
}

const normalizeTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Is an equivalent opener already in the content? The tracker (localStorage)
 * can lose its record, but the CONTENT is the source of truth — adding on top
 * of an existing definition produced verbatim back-to-back duplicates.
 * "exact": the sentence is present verbatim (adoptable for Remove tracking);
 * "similar": present modulo quotes/punctuation/case near the top. Pure,
 * exported for tests.
 */
export function openerPresence(opener: string, content: string): "exact" | "similar" | null {
  if (!opener.trim()) return null;
  if (content.includes(opener)) return "exact";
  const n = normalizeTitle(opener);
  if (n && normalizeTitle(content.slice(0, opener.length * 3 + 400)).includes(n)) {
    return "similar";
  }
  return null;
}

/** Keep only the first copy of a back-to-back duplicated opening block (the
 * server identifies the block; sentence boundary mirrors its regex). */
export function dedupeOpeningBlock(block: string): string {
  const m = /(?<=[.!?])["'”’)]*\s+/.exec(block);
  if (!m) return block;
  const trailer = m[0].replace(/\s+$/, "");
  return block.slice(0, m.index + trailer.length);
}

/**
 * If a section body OPENS with a heading (or bold line) that just repeats the
 * draft title, split it off — the definitional-opener fix moves it out of the
 * way so the opener becomes the true first line instead of being wedged
 * between duplicate headings. Pure and exported for tests.
 */
export function stripDuplicateTitleHeading(
  title: string,
  content: string,
): { rest: string; removed: string } {
  const lines = content.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx === -1) return { rest: content, removed: "" };
  // Strip heading markers / bold wrapping / quotes, then compare to the title.
  const text = lines[firstIdx]
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
  const duplicatesTitle =
    normalizeTitle(title).length > 0 && normalizeTitle(text) === normalizeTitle(title);
  if (!duplicatesTitle) return { rest: content, removed: "" };
  const rest = lines
    .slice(firstIdx + 1)
    .join("\n")
    .replace(/^\s+/, "");
  return { rest, removed: lines[firstIdx] };
}

export function carveProtectedAdditions(
  additions: Additions,
  sectionId: string,
  content: string,
): { core: string; prefix: string; suffix: string } {
  let core = content;
  let prefix = "";
  let suffix = "";
  const op = additions.opener;
  if (op && op.sectionId === sectionId && core.startsWith(op.text)) {
    prefix = `${op.text}\n\n`;
    core = core.slice(op.text.length).replace(/^\s+/, "");
  }
  const fq = additions.faq;
  if (fq && fq.sectionId === sectionId) {
    const trimmed = core.replace(/\s+$/, "");
    if (trimmed.endsWith(fq.text)) {
      suffix = `\n\n${fq.text}`;
      core = trimmed.slice(0, trimmed.length - fq.text.length).replace(/\s+$/, "");
    }
  }
  return { core, prefix, suffix };
}

export function GeoPanel({
  draft,
  onSectionSave,
  onChange,
  onClose,
  onTrackChange,
}: {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onChange: (next: Draft) => Promise<void>;
  onClose: () => void;
  /** Record a panel-applied edit so the editor colors it until approved. The
   *  opening/lede uses the synthetic section id "opening". */
  onTrackChange?: (sectionId: string, before: string, after: string, source: string) => void;
}): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [report, setReport] = useState<GeoReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queriesBusy, setQueriesBusy] = useState(false);
  // True while a targeted per-lever re-score is in flight after a fix.
  const [rescoring, setRescoring] = useState(false);
  // When the shown report came from cache (unchanged draft), this is when it
  // was originally scored — surfaced so the writer knows it isn't stale.
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const contentHash = useMemo(() => hashDraftContent(draft), [draft]);

  // A notice the writer can't miss: surface it at the top and scroll there.
  const showNotice = useCallback(
    (msg: string): void => {
      setNotice(msg);
      panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [panelRef],
  );

  const run = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCachedAt(null);
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
  // otherwise run a fresh scan. Re-analyze always bypasses the cache.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    const hit = getCached<GeoReport>("geo", draft.id, contentHash);
    if (hit) {
      setReport(hit.data);
      setCachedAt(hit.at);
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
      showNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setRescoring(false);
    }
  }, [draft.id, showNotice]);

  const queueRescore = useCallback(
    (leverKey: string): void => {
      if (!leverKey) return;
      pendingRescore.current.add(leverKey);
      if (rescoreTimer.current) window.clearTimeout(rescoreTimer.current);
      rescoreTimer.current = window.setTimeout(() => void flushRescore(), 900);
    },
    [flushRescore],
  );

  // The opening/lede is a first-class field (outline.opening_hook), edited in
  // the Intro card and scored as the article's true opening — so the opener
  // fixes operate on IT, not on the first section. The rail persists opener
  // fixes through this callback.
  const saveOpening = useCallback(
    async (opening_hook: string): Promise<void> => {
      const outline = draft.outline ?? { opening_hook: "", sections: [], estimated_words: 0 };
      const before = draft.outline?.opening_hook ?? "";
      await onChange({ ...draft, outline: { ...outline, opening_hook } });
      onTrackChange?.("opening", before, opening_hook, "geo:opening");
    },
    [draft, onChange, onTrackChange],
  );

  async function copyQueries(): Promise<void> {
    setQueriesBusy(true);
    setError(null);
    try {
      const qs = await geoQueries(draft.id);
      await navigator.clipboard.writeText(qs.join("\n"));
      setNotice(
        `Copied ${qs.length} target queries — paste them into ChatGPT/Perplexity weekly and note who gets cited (measurement is manual).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setQueriesBusy(false);
    }
  }

  const grade = report ? gradeColor(report.grade) : gradeColor("F");

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="GEO optimizer"
      className="fixed right-0 top-0 z-30 h-full w-[460px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
    >
      {rescoring && <BusyOverlay label="Re-scoring the changed lever…" />}
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            GEO optimizer
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={copyQueries}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={queriesBusy || !report}
              title="Copy the queries this post should rank for — to check citations manually"
            >
              {queriesBusy ? "…" : "Copy target queries"}
            </button>
            <button
              type="button"
              onClick={run}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={busy}
            >
              {busy ? "Analyzing…" : "Re-analyze"}
            </button>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div
            className="flex flex-col items-center justify-center rounded-nb-sm px-3 py-1.5 min-w-[4.5rem]"
            style={{ background: grade.bg, border: `1px solid ${grade.bd}`, color: grade.fg }}
          >
            <span className="text-2xl font-bold leading-none tabular-nums">
              {report?.score ?? "—"}
            </span>
            <span className="text-xs font-semibold">Grade {report?.grade ?? "—"}</span>
          </div>
          <p className="text-xs text-muted leading-snug">
            Structural GEO readiness — how extractable this draft is for AI answer engines.{" "}
            <span className="text-muted-2">
              Not a citation guarantee; off-page authority matters more.
            </span>
          </p>
        </div>
        {cachedAt !== null && !busy && (
          <p className="mt-1.5 text-xs text-muted-2">
            Scored {formatAgo(cachedAt)} · draft unchanged since
          </p>
        )}
      </header>

      {error && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fbf1de", border: "1px solid #f3d89b", color: "#92600a" }}
        >
          {notice}
        </div>
      )}
      {rescoring && !busy && (
        <div className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm bg-cobalt-50 text-cobalt-800">
          Re-scoring the changed lever…
        </div>
      )}

      {!error && (
        <div className="p-6 space-y-4">
          {busy && !report && (
            <p className="py-10 text-center text-sm text-muted">Scoring your draft…</p>
          )}

          {report && (
            <GeoReviewRail
              report={report}
              draft={draft}
              onSectionSave={onSectionSave}
              onOpeningSave={saveOpening}
              onRescore={(lever) => queueRescore(lever)}
            />
          )}
        </div>
      )}
    </div>
  );
}
