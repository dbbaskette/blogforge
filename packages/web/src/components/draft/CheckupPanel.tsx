import { useCallback, useEffect, useMemo, useState } from "react";

import { type Draft, lintDraft } from "../../api/drafts";
import { type GeoReport, analyzeGeo } from "../../api/geo";
import { type SuggestResult, suggestImprovements } from "../../api/suggest";
import { type CheckupSummary, type Severity, summarizeCheckup } from "../../lib/checkup";
import { getCached, hashDraftContent, setCached } from "../../lib/panelCache";
import { useDialogA11y } from "../ui/useDialogA11y";

const SEV: Record<Severity, { dot: string; text: string }> = {
  good: { dot: "#15a06b", text: "text-green-ink" },
  warn: { dot: "#f59e0b", text: "text-amber-ink" },
  bad: { dot: "#e6492d", text: "text-coral-ink" },
};

/**
 * Checkup — runs Review (lint) + GEO + Shape together and shows one prioritized
 * summary, with a jump into each detail panel (which reuse the same cached
 * results, so they open instantly). The front door for "how's my draft?".
 */
export function CheckupPanel({
  draft,
  onOpenReview,
  onOpenGeo,
  onOpenShape,
  onClose,
}: {
  draft: Draft;
  onOpenReview: () => void;
  onOpenGeo: () => void;
  onOpenShape: () => void;
  onClose: () => void;
}): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [summary, setSummary] = useState<CheckupSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hash = useMemo(() => hashDraftContent(draft), [draft]);

  const run = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // GEO / Shape reuse the panel cache when the draft is unchanged; lint is
      // cheap and always fresh. allSettled so one failure doesn't sink the rest.
      const loadGeo = async (): Promise<GeoReport> => {
        const hit = getCached<GeoReport>("geo", draft.id, hash);
        if (hit) return hit.data;
        const fresh = await analyzeGeo(draft.id);
        setCached("geo", draft.id, hash, fresh);
        return fresh;
      };
      const loadShape = async (): Promise<SuggestResult> => {
        const hit = getCached<SuggestResult>("shape", draft.id, hash);
        if (hit) return hit.data;
        const fresh = await suggestImprovements(draft.id);
        setCached("shape", draft.id, hash, fresh);
        return fresh;
      };
      const [lintR, geoR, shapeR] = await Promise.allSettled([
        lintDraft(draft.id),
        loadGeo(),
        loadShape(),
      ]);
      setSummary(
        summarizeCheckup(
          lintR.status === "fulfilled" ? lintR.value : null,
          geoR.status === "fulfilled" ? geoR.value : null,
          shapeR.status === "fulfilled" ? shapeR.value : null,
        ),
      );
      if (
        lintR.status === "rejected" &&
        geoR.status === "rejected" &&
        shapeR.status === "rejected"
      ) {
        setError("Couldn't run the checks — try again.");
      }
    } finally {
      setBusy(false);
    }
  }, [draft.id, hash]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    run();
  }, []);

  const open: Record<string, () => void> = {
    review: onOpenReview,
    geo: onOpenGeo,
    shape: onOpenShape,
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Checkup"
      className="fixed right-0 top-0 z-30 h-full w-[420px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
    >
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">Checkup</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={run}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={busy}
            >
              {busy ? "Running…" : "Re-run"}
            </button>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <h2 className="mt-1 font-serif text-2xl font-medium text-ink tracking-tight">
          {summary ? summary.headline : "Checking your draft…"}
        </h2>
        {summary && (
          <p className="mt-1 text-xs text-muted">
            Reads {summary.humanity}% human ·{" "}
            {summary.totalOpen === 0 ? "nothing open" : `${summary.totalOpen} to address`}
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

      <div className="p-6 space-y-3">
        {busy && !summary && (
          <p className="py-10 text-center text-sm text-muted">Running all checks…</p>
        )}

        {summary?.rows.map((row) => (
          <div key={row.key} className="glass-card p-3 flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: SEV[row.severity].dot }}
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink">{row.label}</p>
              <p className={`text-xs leading-snug ${SEV[row.severity].text}`}>{row.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => open[row.key]?.()}
              className="nb-btn nb-btn-sm shrink-0"
            >
              Open →
            </button>
          </div>
        ))}

        {summary && (
          <p className="text-xs text-muted-2 leading-snug pt-1">
            Mechanical voice-rule issues come first, then structure, then optional suggestions. Open
            a section to apply its fixes.
          </p>
        )}
      </div>
    </div>
  );
}
