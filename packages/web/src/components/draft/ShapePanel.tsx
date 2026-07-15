/**
 * The Shape Assistant panel — its own header, run/re-run controls, and cache
 * wiring, but the findings list is the shared ReviewRail (the same IssueCard +
 * useIssueLifecycle machine GEO and Humanize use). Shape thereby gains undo
 * and the open → review → accepted state it previously had neither of: a
 * picked reword/expand used to apply immediately with no way back, and now
 * routes through the rail's preview modal → confirm → accept/undo like every
 * other panel. Dismissal also moves to the rail's shared store, with the
 * "Show dismissed" toggle + Restore.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Draft } from "../../api/drafts";
import { type SuggestResult, suggestImprovements } from "../../api/suggest";
import { SHAPE_GROUPS, shapeSuggestionsToIssues } from "../../lib/issues/shapeAdapter";
import { makeShapeApply } from "../../lib/issues/shapeApply";
import { formatAgo, hashDraftContent, peekCached, setCached } from "../../lib/panelCache";
import { type ReviewGroup, ReviewRail } from "../review/ReviewRail";
import { useDialogA11y } from "../ui/useDialogA11y";

export function ShapePanel({
  draft,
  onSectionSave,
  onClose,
  autoRun = false,
}: {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onClose: () => void;
  autoRun?: boolean;
}): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  // Saved suggestions predate the current content — keep showing them until the
  // writer chooses to Re-run.
  const [stale, setStale] = useState(false);

  const contentHash = useMemo(() => hashDraftContent(draft), [draft]);

  const run = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setCachedAt(null);
    try {
      const fresh = await suggestImprovements(draft.id);
      setResult(fresh);
      setCached("shape", draft.id, hashDraftContent(draft), fresh);
      setStale(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  // On open: restore the last saved suggestions ALWAYS — even after edits. A
  // fresh pass only happens on an explicit Re-run, or the first time (autoRun)
  // when nothing is saved yet. `stale` flags "edited since scan".
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    const saved = peekCached<SuggestResult>("shape", draft.id);
    if (saved) {
      setResult(saved.data);
      setCachedAt(saved.at);
      setStale(saved.hash !== contentHash);
    } else if (autoRun) {
      run();
    }
  }, []);

  const issues = useMemo(() => (result ? shapeSuggestionsToIssues(result) : []), [result]);
  const apply = useMemo(() => makeShapeApply({ draft, onSectionSave }), [draft, onSectionSave]);
  const save = useMemo(
    () => (sectionId: string, content: string) => onSectionSave(sectionId, content, true),
    [onSectionSave],
  );
  const groups = useMemo<ReviewGroup[]>(
    () => SHAPE_GROUPS.map((g) => ({ key: g.key, label: g.label, detail: g.detail })),
    [],
  );

  const hasRun = result !== null;
  const total = issues.length;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Shape Assistant"
      className="fixed right-0 top-0 z-30 h-full w-[440px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
    >
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            Shape Assistant
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={run}
              className="nb-btn nb-btn-ghost nb-btn-sm"
              disabled={busy}
            >
              {busy ? "Analyzing…" : hasRun ? "Re-run" : "Analyze"}
            </button>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <h2 className="mt-1 font-serif text-2xl font-medium text-ink tracking-tight">
          Shape your draft {total > 0 && <span className="text-cobalt-600">· {total}</span>}
        </h2>
        {cachedAt !== null && !busy && (
          <p className="mt-1 text-xs text-muted-2">
            Suggested {formatAgo(cachedAt)} ·{" "}
            {stale ? (
              <button
                type="button"
                onClick={run}
                className="font-medium text-amber-ink underline underline-offset-2 hover:text-ink"
              >
                draft edited since — Re-run
              </button>
            ) : (
              "draft unchanged since"
            )}
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
      {!error && (
        <div className="p-6 space-y-6">
          {!hasRun && !busy && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Run a voice-aware pass over your draft for claims worth verifying, sharper wordings,
                and places to add substance. Nothing changes until you apply it.
              </p>
              <button type="button" onClick={run} className="nb-btn nb-btn-primary">
                ✨ Shape this draft
              </button>
            </div>
          )}

          {busy && <p className="py-10 text-center text-sm text-muted">Analyzing your draft…</p>}

          {hasRun && !busy && (
            <ReviewRail
              issues={issues}
              groups={groups}
              draftId={draft.id}
              apply={apply}
              save={save}
              groupLabelFor={(key) => SHAPE_GROUPS.find((g) => g.key === key)?.label ?? key}
              emptyState={
                <p className="text-sm text-muted italic font-serif py-6 text-center">
                  Nothing flagged — this reads well as-is.
                </p>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
