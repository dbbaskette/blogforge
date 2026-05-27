import { useEffect, useMemo, useRef, useState } from "react";

import { type Draft, downloadDraftUrl } from "../../api/drafts";
import { type ExpandJobHandlers, useExpandJob } from "../../hooks/useExpandJob";
import { LintPanel } from "./LintPanel";
import { SectionCard } from "./SectionCard";
import { Spinner, StageHeader } from "./Stage1Idea";

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
    <div className="space-y-5 pb-28 animate-fade-up">
      <StageHeader
        eyebrow="Stage 03 · Drafting"
        title="Write the piece."
        subline="Sections compose in your voice. Edit, regenerate, reorder. Copy or download when ready."
      />

      {/* Action row — expand / status */}
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10px] uppercase tracking-wide-3 text-muted">
          {draft.sections.length.toString().padStart(2, "0")} section
          {draft.sections.length === 1 ? "" : "s"}
          {totalWords > 0 && (
            <>
              {" · "}
              <span className="font-mono-num text-cream-2">{totalWords.toLocaleString()}</span>{" "}
              words
            </>
          )}
        </div>
        {unfilledCount > 0 && !jobRunning && (
          <button type="button" onClick={() => onExpandUnfilled()} className="btn-stamp">
            Expand {unfilledCount.toString().padStart(2, "0")} unfilled →
          </button>
        )}
        {jobRunning && (
          <span className="font-mono text-[11px] uppercase tracking-wide-3 text-gold flex items-center gap-2">
            <Spinner /> Composing {generatingIds.size} section
            {generatingIds.size === 1 ? "" : "s"}…
          </span>
        )}
      </div>

      {jobError && (
        <div className="border-l-2 border-vermilion pl-4 py-3 bg-vermilion-900/30">
          <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400">
            expand failed
          </p>
          <p className="text-sm text-cream/85 mt-1">{jobError.message}</p>
          {jobError.hint && <p className="text-xs text-cream/65 mt-1">{jobError.hint}</p>}
          <button
            type="button"
            onClick={() => setJobError(null)}
            className="mt-2 font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400 hover:text-vermilion-300 underline underline-offset-4"
          >
            dismiss
          </button>
        </div>
      )}

      {draft.sections.length === 0 && (
        <p className="font-prose italic text-muted text-sm text-center py-10 border-y border-rule">
          No sections yet.
        </p>
      )}

      <div className="space-y-5">
        {draft.sections.map((section, i) => (
          <div key={section.id} className="group/section space-y-1">
            <SectionCard
              section={section}
              index={i}
              isGenerating={generatingIds.has(section.id)}
              onSave={(md) => onSectionSave(section.id, md)}
              onRegenerate={() => onRegenerateSection(section.id)}
            />
            <div className="flex gap-2 justify-end pr-1 opacity-0 group-hover/section:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => moveSection(i, -1)}
                disabled={i === 0}
                className="font-mono text-[10px] uppercase tracking-wide-3 text-muted-2 hover:text-cream disabled:opacity-20 disabled:hover:text-muted-2"
                aria-label="Move section up"
              >
                ↑ up
              </button>
              <button
                type="button"
                onClick={() => moveSection(i, 1)}
                disabled={i === draft.sections.length - 1}
                className="font-mono text-[10px] uppercase tracking-wide-3 text-muted-2 hover:text-cream disabled:opacity-20 disabled:hover:text-muted-2"
                aria-label="Move section down"
              >
                ↓ down
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Sticky press-foot footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-surface/95 border-t border-rule-2 backdrop-blur-sm z-10">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-4">
          <span className="font-mono text-[10px] uppercase tracking-wide-3 text-muted">
            <span className="text-vermilion-400">●</span> proof
          </span>
          <span className="font-mono-num text-sm text-cream-2">{totalWords.toLocaleString()}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide-3 text-muted">words</span>
          <div className="flex-1" />
          <button type="button" onClick={handleCopyMarkdown} className="btn-press text-xs">
            {copyMessage ?? "Copy markdown"}
          </button>
          <a href={downloadDraftUrl(draft.id)} download className="btn-press text-xs">
            Download .md
          </a>
          <button type="button" onClick={() => setLintOpen(true)} className="btn-press text-xs">
            Lint full doc
          </button>
        </div>
      </footer>

      {lintOpen && <LintPanel draftId={draft.id} onClose={() => setLintOpen(false)} />}
    </div>
  );
}
