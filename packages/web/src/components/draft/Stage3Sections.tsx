import { useEffect, useMemo, useRef, useState } from "react";

import { type Draft, downloadDraftUrl } from "../../api/drafts";
import { type ExpandJobHandlers, useExpandJob } from "../../hooks/useExpandJob";
import { LintPanel } from "./LintPanel";
import { SectionCard } from "./SectionCard";

interface Stage3SectionsProps {
  draft: Draft;
  jobId: string | null;
  onSectionSave: (sectionId: string, content_md: string) => Promise<void>;
  onRegenerateSection: (sectionId: string) => Promise<void>;
  onReorder: (section_ids: string[]) => Promise<void>;
  onExpandUnfilled: () => Promise<void>;
  onJobComplete?: () => void;
}

export function Stage3Sections({
  draft,
  jobId,
  onSectionSave,
  onRegenerateSection,
  onReorder,
  onExpandUnfilled,
  onJobComplete,
}: Stage3SectionsProps): JSX.Element {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [lintOpen, setLintOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [jobError, setJobError] = useState<{ message: string; hint?: string } | null>(null);

  // Use a ref to hold stable handler refs so useExpandJob effect does not re-fire.
  const handlersRef = useRef<ExpandJobHandlers>({
    onSectionStart: () => {},
    onSectionDone: () => {},
    onComplete: () => {},
    onError: () => {},
  });

  handlersRef.current = useMemo<ExpandJobHandlers>(
    () => ({
      onSectionStart: (id) => {
        setGeneratingIds((prev) => new Set([...prev, id]));
      },
      onSectionDone: (id) => {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
      onComplete: () => {
        setGeneratingIds(new Set());
        setJobError(null);
        onJobComplete?.();
      },
      onError: (_code, message, hint) => {
        setGeneratingIds(new Set());
        setJobError({ message, hint });
        // Also re-fetch the draft so per-section "failed" statuses show up.
        onJobComplete?.();
      },
    }),
    // onJobComplete is stable (useCallback in DraftPage), so including it is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onJobComplete],
  );

  // Stable proxy so useExpandJob's dependency on `handlers` stays constant.
  const stableHandlers = useMemo<ExpandJobHandlers>(
    () => ({
      onSectionStart: (id) => handlersRef.current.onSectionStart(id),
      onSectionDone: (id) => handlersRef.current.onSectionDone(id),
      onComplete: (r) => handlersRef.current.onComplete(r),
      onError: (c, m, h) => handlersRef.current.onError(c, m, h),
    }),
    [],
  );

  useExpandJob(jobId, stableHandlers);

  // Pre-mark sections the server already marked as "generating".
  useEffect(() => {
    const alreadyGenerating = draft.sections
      .filter((s) => s.status === "generating")
      .map((s) => s.id);
    if (alreadyGenerating.length > 0) {
      setGeneratingIds((prev) => new Set([...prev, ...alreadyGenerating]));
    }
  }, [draft.sections]);

  const totalWords = draft.sections.reduce((acc, s) => acc + s.word_count, 0);

  const handleCopyMarkdown = async () => {
    try {
      const res = await fetch(downloadDraftUrl(draft.id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopyMessage("Copied!");
      setTimeout(() => setCopyMessage(null), 2000);
    } catch {
      setCopyMessage("Copy failed");
      setTimeout(() => setCopyMessage(null), 2000);
    }
  };

  const moveSection = async (idx: number, dir: -1 | 1) => {
    const ids = draft.sections.map((s) => s.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= ids.length) return;
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    await onReorder(ids).catch(() => {});
  };

  const unfilledCount = draft.sections.filter(
    (s) => s.status !== "ready" && s.status !== "edited",
  ).length;
  const jobRunning = jobId !== null && generatingIds.size > 0;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Sections</h2>
        {unfilledCount > 0 && !jobRunning && (
          <button
            type="button"
            onClick={() => onExpandUnfilled()}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded"
          >
            Expand {unfilledCount} unfilled section{unfilledCount === 1 ? "" : "s"} →
          </button>
        )}
        {jobRunning && (
          <span className="text-sm text-amber-400">
            Generating {generatingIds.size} section{generatingIds.size === 1 ? "" : "s"}…
          </span>
        )}
      </div>

      {jobError && (
        <div className="bg-red-900/40 border border-red-700 text-red-200 rounded p-3 text-sm">
          <div className="font-medium">Expand failed: {jobError.message}</div>
          {jobError.hint && <div className="text-red-300/80 mt-1">{jobError.hint}</div>}
          <button
            type="button"
            onClick={() => setJobError(null)}
            className="mt-2 text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {draft.sections.length === 0 && <p className="text-slate-500 text-sm">No sections yet.</p>}

      {draft.sections.map((section, i) => (
        <div key={section.id} className="space-y-1">
          <SectionCard
            section={section}
            isGenerating={generatingIds.has(section.id)}
            onSave={(md) => onSectionSave(section.id, md)}
            onRegenerate={() => onRegenerateSection(section.id)}
          />
          <div className="flex gap-1 justify-end">
            <button
              type="button"
              onClick={() => moveSection(i, -1)}
              disabled={i === 0}
              className="text-slate-600 hover:text-slate-400 disabled:opacity-20 text-xs"
              aria-label="Move section up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveSection(i, 1)}
              disabled={i === draft.sections.length - 1}
              className="text-slate-600 hover:text-slate-400 disabled:opacity-20 text-xs"
              aria-label="Move section down"
            >
              ↓
            </button>
          </div>
        </div>
      ))}

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-6 py-3 flex items-center gap-4 backdrop-blur-sm z-10">
        <span className="text-sm text-slate-400">
          {totalWords > 0 ? `${totalWords} words` : "0 words"}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleCopyMarkdown}
          className="px-3 py-1.5 text-xs border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
        >
          {copyMessage ?? "Copy markdown"}
        </button>
        <a
          href={downloadDraftUrl(draft.id)}
          download
          className="px-3 py-1.5 text-xs border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
        >
          Download .md
        </a>
        <button
          type="button"
          onClick={() => setLintOpen(true)}
          className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-200"
        >
          Lint full doc
        </button>
      </div>

      {lintOpen && <LintPanel draftId={draft.id} onClose={() => setLintOpen(false)} />}
    </div>
  );
}
