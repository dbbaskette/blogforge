import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { Draft, IdeaInput, OutlineProposal } from "../../api/drafts";
import { useDebouncedSave } from "../../hooks/useDebouncedSave";
import { type ExpandJobHandlers, useExpandJob } from "../../hooks/useExpandJob";
import { IdeaPanel } from "./IdeaPanel";
import { LintPanel } from "./LintPanel";
import { OutlinePanel } from "./OutlinePanel";
import { OutlineSidebar } from "./OutlineSidebar";
import { SectionsPanel } from "./SectionsPanel";
import { SetupDisclosure } from "./SetupDisclosure";
import { WorkspaceFooter } from "./WorkspaceFooter";

export interface DraftWorkspaceProps {
  draft: Draft;
  jobId: string | null;
  saving: boolean;
  saveError: string | null;
  onChange: (next: Draft) => Promise<void>;
  onGenerateOutline: () => Promise<void>;
  onExpandAll: () => Promise<void>;
  onExpandUnfilled: () => Promise<void>;
  onSectionSave: (sectionId: string, content_md: string) => Promise<void>;
  onRegenerateSection: (sectionId: string) => Promise<void>;
  onReorder: (section_ids: string[]) => Promise<void>;
  onJobComplete: () => void;
}

export function DraftWorkspace({
  draft,
  jobId,
  saving,
  saveError,
  onChange,
  onGenerateOutline,
  onExpandAll,
  onExpandUnfilled,
  onSectionSave,
  onRegenerateSection,
  onReorder,
  onJobComplete,
}: DraftWorkspaceProps): JSX.Element {
  const [lintOpen, setLintOpen] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [jobError, setJobError] = useState<{ message: string; hint?: string } | null>(null);

  // Stable handlers for the expand-job SSE stream.
  const handlersRef = useRef<ExpandJobHandlers>({
    onSectionStart: () => {},
    onSectionDone: () => {},
    onComplete: () => {},
    onError: () => {},
  });
  handlersRef.current = useMemo<ExpandJobHandlers>(
    () => ({
      onSectionStart: (id) => setGeneratingIds((prev) => new Set([...prev, id])),
      onSectionDone: (id) =>
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      onComplete: () => {
        setGeneratingIds(new Set());
        setJobError(null);
        onJobComplete();
      },
      onError: (_code, message, hint) => {
        setGeneratingIds(new Set());
        setJobError({ message, hint });
        onJobComplete();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onJobComplete],
  );
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

  useEffect(() => {
    const alreadyGenerating = draft.sections
      .filter((s) => s.status === "generating")
      .map((s) => s.id);
    if (alreadyGenerating.length > 0) {
      setGeneratingIds((prev) => new Set([...prev, ...alreadyGenerating]));
    }
  }, [draft.sections]);

  // ── Local editable state for idea / outline, debounced into onChange. ──
  const [advancing, setAdvancing] = useState(false);
  const [topic, setTopic] = useState(draft.title);

  useEffect(() => setTopic(draft.title), [draft.title]);

  // Build the next draft from a partial idea or outline patch, then push it.
  const handleIdeaChange = useCallback(
    (next: IdeaInput) => {
      const merged: Draft = {
        ...draft,
        idea: next,
        title: next.topic || draft.title,
      };
      setTopic(merged.title);
      onChange(merged);
    },
    [draft, onChange],
  );

  const handleOutlineChange = useCallback(
    (next: OutlineProposal) => {
      onChange({ ...draft, outline: next });
    },
    [draft, onChange],
  );

  // Debounce title edits separately so typing doesn't fire one save per keystroke.
  const titleSave = useDebouncedSave(
    topic,
    async (t: string) => {
      if (t === draft.title) return;
      if (advancing) return;
      await onChange({ ...draft, title: t, idea: { ...draft.idea, topic: t } });
    },
    600,
  );

  // ── Derived ──
  const totalWords = draft.sections.reduce((acc, s) => acc + s.word_count, 0);
  const targetWords = draft.idea.target_words ?? 1500;
  const draftedCount = draft.sections.filter(
    (s) => s.status === "ready" || s.status === "edited",
  ).length;
  const unfilledCount = draft.sections.filter(
    (s) => s.status !== "ready" && s.status !== "edited",
  ).length;
  const jobRunning = jobId !== null && generatingIds.size > 0;

  const handleGenerate = useCallback(async () => {
    setAdvancing(true);
    try {
      await onGenerateOutline();
    } finally {
      setAdvancing(false);
    }
  }, [onGenerateOutline]);

  const handleExpandAll = useCallback(async () => {
    setAdvancing(true);
    try {
      await onExpandAll();
    } finally {
      setAdvancing(false);
    }
  }, [onExpandAll]);

  const showFooter = draft.stage === "sections" && draft.sections.length > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-8 grid lg:grid-cols-[220px_minmax(0,1fr)] gap-8">
      <OutlineSidebar
        draft={draft}
        generatingIds={generatingIds}
        totalWords={totalWords}
        targetWords={targetWords}
      />

      <main className="min-w-0 max-w-3xl pb-32">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="nb-btn nb-btn-ghost nb-btn-sm no-underline -ml-2">
            ← All drafts
          </Link>
          <span className="text-xs flex items-center gap-2 text-muted">
            {saving || titleSave.saving ? (
              <>
                <span
                  aria-hidden
                  className="inline-block w-2 h-2 rounded-full bg-amber animate-pulse"
                />
                Saving…
              </>
            ) : saveError || titleSave.error ? (
              <span className="text-rose-ink">Save error: {saveError ?? titleSave.error}</span>
            ) : (
              <>
                <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-leaf" />
                All changes saved
              </>
            )}
          </span>
        </div>

        {/* Hero — editable title */}
        <header className="mb-6">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Untitled draft"
            className="w-full bg-transparent border-0 px-0 py-1 font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight focus:outline-none placeholder:text-muted-2"
            aria-label="Draft title"
          />
        </header>

        {/* Setup — collapsed unless we're at the idea stage */}
        <SetupDisclosure
          draft={draft}
          onChange={handleIdeaChange}
          forceOpen={draft.stage === "idea"}
        />

        {/* Stage-specific body */}
        {draft.stage === "idea" && (
          <IdeaPanel
            idea={draft.idea}
            draft={draft}
            onChange={handleIdeaChange}
            onAdvance={handleGenerate}
          />
        )}

        {draft.stage === "outline" && (
          <OutlinePanel
            draft={draft}
            onChange={handleOutlineChange}
            onAdvance={handleExpandAll}
            onRegenerate={handleGenerate}
          />
        )}

        {draft.stage === "sections" && (
          <SectionsPanel
            draft={draft}
            generatingIds={generatingIds}
            jobError={jobError}
            onDismissJobError={() => setJobError(null)}
            unfilledCount={unfilledCount}
            jobRunning={jobRunning}
            onSectionSave={onSectionSave}
            onRegenerateSection={onRegenerateSection}
            onReorder={onReorder}
            onExpandUnfilled={onExpandUnfilled}
          />
        )}
      </main>

      {showFooter && (
        <WorkspaceFooter
          draftId={draft.id}
          totalWords={totalWords}
          draftedCount={draftedCount}
          sectionCount={draft.sections.length}
          onLint={() => setLintOpen(true)}
        />
      )}

      {lintOpen && <LintPanel draftId={draft.id} onClose={() => setLintOpen(false)} />}
    </div>
  );
}
