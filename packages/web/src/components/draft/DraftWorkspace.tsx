import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { Draft, DraftStage, IdeaInput, OutlineProposal } from "../../api/drafts";
import { createTemplateFromDraft } from "../../api/templates";
import { useDebouncedSave } from "../../hooks/useDebouncedSave";
import { type ExpandJobHandlers, useExpandJob } from "../../hooks/useExpandJob";
import { approveAll, loadPending, prunePending, trackChange } from "../../lib/trackedChanges";
import { InlineMarkdown } from "../ui/InlineMarkdown";
import { HeroImage } from "./HeroImage";
import { OutlinePanel } from "./OutlinePanel";
import { OutlineSidebar } from "./OutlineSidebar";
import { ReferencesList } from "./ReferencesList";
import { ResearchPanel } from "./ResearchPanel";
import { SetupDisclosure } from "./SetupDisclosure";
import { StageNav } from "./StageNav";
import { WorkspaceFooter } from "./WorkspaceFooter";

// The sections stage carries the TipTap editor stack (the heaviest dependency
// in the app) — lazy-load it so research/outline sessions and every other page
// never download it.
const OpeningCard = lazy(() => import("./OpeningCard").then((m) => ({ default: m.OpeningCard })));
const SectionsPanel = lazy(() =>
  import("./SectionsPanel").then((m) => ({ default: m.SectionsPanel })),
);

// The review/improve overlays are on-demand — lazy-load them so their code
// (and heavyweight deps) stays out of the initial chunk. Each opens from an
// explicit click, so the fetch hides inside the open animation.
const CheckupPanel = lazy(() => import("./CheckupPanel").then((m) => ({ default: m.CheckupPanel })));
const HeadlineLab = lazy(() => import("./HeadlineLab").then((m) => ({ default: m.HeadlineLab })));
const HumanizePanel = lazy(() =>
  import("./HumanizePanel").then((m) => ({ default: m.HumanizePanel })),
);
const LintPanel = lazy(() => import("./LintPanel").then((m) => ({ default: m.LintPanel })));
const OptimizePanel = lazy(() =>
  import("./OptimizePanel").then((m) => ({ default: m.OptimizePanel })),
);
const RepurposePanel = lazy(() =>
  import("./RepurposePanel").then((m) => ({ default: m.RepurposePanel })),
);
const ShapePanel = lazy(() => import("./ShapePanel").then((m) => ({ default: m.ShapePanel })));

const INLINE_AI_HINT_KEY = "bf.inlineai.hint.dismissed";

export interface DraftWorkspaceProps {
  draft: Draft;
  jobId: string | null;
  saving: boolean;
  saveError: string | null;
  onChange: (next: Draft) => Promise<void>;
  onGenerateOutline: () => Promise<void>;
  onExpandAll: () => Promise<void>;
  onExpandUnfilled: () => Promise<void>;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onRegenerateSection: (sectionId: string, instruction?: string) => Promise<void>;
  onRevertSection: (sectionId: string, versionId: string) => Promise<void>;
  onReviseDraft: (instruction: string) => Promise<void>;
  onJumpStage: (stage: DraftStage) => Promise<void>;
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
  onRevertSection,
  onReviseDraft,
  onJumpStage,
  onReorder,
  onJobComplete,
}: DraftWorkspaceProps): JSX.Element {
  const [lintOpen, setLintOpen] = useState(false);
  const [repurposeOpen, setRepurposeOpen] = useState(false);
  const [headlinesOpen, setHeadlinesOpen] = useState(false);
  const [shapeOpen, setShapeOpen] = useState(false);
  const [geoOpen, setGeoOpen] = useState(false);
  const [humanizeOpen, setHumanizeOpen] = useState(false);
  const [checkupOpen, setCheckupOpen] = useState(false);
  // Import lands here verbatim — no tool runs and nothing is edited until the
  // writer asks for it (Improve ▾ → Shape/GEO/Proofread). The shaping pass is
  // never auto-run on an imported draft.
  // One-time hint pointing authors at select-text inline AI. Persisted dismissed.
  const [inlineHintDismissed, setInlineHintDismissed] = useState(
    () => localStorage.getItem(INLINE_AI_HINT_KEY) === "1",
  );
  const dismissInlineHint = useCallback(() => {
    localStorage.setItem(INLINE_AI_HINT_KEY, "1");
    setInlineHintDismissed(true);
  }, []);
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [jobError, setJobError] = useState<{ message: string; hint?: string } | null>(null);
  // True from the instant Compose fires until the job completes/errors —
  // independent of generatingIds, which stays empty during the latency
  // window before the first SSE section:start event arrives.
  const [jobActive, setJobActive] = useState(false);
  // When set, exactly one section is being regenerated (not a bulk expand),
  // so we can stream the token deltas straight into the matching card.
  const [liveSectionId, setLiveSectionId] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  // True while a single-pass whole-draft compose is running. Expand writes the
  // entire post in ONE call, so we show one unified "composing the full draft"
  // state instead of every section card spinning (which looked section-by-
  // section). Per-section regenerate/revise leave this false.
  const [composingWholeDraft, setComposingWholeDraft] = useState(false);

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
      // Only buffer tokens when a single section is regenerating; bulk expand
      // interleaves tokens from concurrent sections with no attribution.
      onToken: (delta) => {
        if (liveSectionId) setLiveText((prev) => prev + delta);
      },
      onComplete: () => {
        setGeneratingIds(new Set());
        setJobError(null);
        setJobActive(false);
        setLiveSectionId(null);
        setLiveText("");
        setComposingWholeDraft(false);
        onJobComplete();
      },
      onError: (_code, message, hint) => {
        setGeneratingIds(new Set());
        setJobError({ message, hint });
        setJobActive(false);
        setLiveSectionId(null);
        setLiveText("");
        setComposingWholeDraft(false);
        onJobComplete();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onJobComplete, liveSectionId],
  );
  const stableHandlers = useMemo<ExpandJobHandlers>(
    () => ({
      onSectionStart: (id) => handlersRef.current.onSectionStart(id),
      onSectionDone: (id) => handlersRef.current.onSectionDone(id),
      onToken: (d) => handlersRef.current.onToken?.(d),
      onComplete: (r) => handlersRef.current.onComplete(r),
      onError: (c, m, h) => handlersRef.current.onError(c, m, h),
    }),
    [],
  );
  useExpandJob(jobId, stableHandlers);

  // Flip jobActive on the moment a new jobId arrives (Compose / regenerate
  // clicked) so the progress UI shows immediately, before the first SSE
  // event. onComplete/onError flip it back off.
  useEffect(() => {
    if (jobId !== null) setJobActive(true);
  }, [jobId]);

  useEffect(() => {
    const alreadyGenerating = draft.sections
      .filter((s) => s.status === "generating")
      .map((s) => s.id);
    if (alreadyGenerating.length > 0) {
      setGeneratingIds((prev) => new Set([...prev, ...alreadyGenerating]));
    }
  }, [draft.sections]);

  // ── Local editable state for research / outline, debounced into onChange. ──
  const [advancing, setAdvancing] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  // The stored title keeps its markdown verbatim (so exports stay faithful);
  // the heading RENDERS it, and editing works on the raw text.
  const [topic, setTopic] = useState(draft.title);

  useEffect(() => setTopic(draft.title), [draft.title]);

  // Tracked changes: panel-applied edits (GEO/Proofreader) colored in the
  // editors until approved. The "opening" lede uses the synthetic id "opening".
  const [pending, setPending] = useState(() => loadPending(draft.id));
  const refreshPending = useCallback(() => setPending(loadPending(draft.id)), [draft.id]);
  const pendingTextsForSection = useCallback(
    (sectionId: string): string[] =>
      pending.filter((c) => c.sectionId === sectionId).map((c) => c.text),
    [pending],
  );
  const handleTrackChange = useCallback(
    (sectionId: string, before: string, after: string, source: string): void => {
      trackChange(draft.id, sectionId, before, after, source);
      refreshPending();
    },
    [draft.id, refreshPending],
  );
  // Drop runs the writer edited away; re-read whenever draft content changes.
  useEffect(() => {
    const secs = draft.sections.map((s) => ({ id: s.id, content_md: s.content_md }));
    secs.push({ id: "opening", content_md: draft.outline?.opening_hook ?? "" });
    prunePending(draft.id, secs);
    setPending(loadPending(draft.id));
  }, [draft.id, draft.sections, draft.outline]);

  // Build the next draft from a partial research/idea or outline patch, then push it.
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

  // Persist an edit to the article's opening (stored as outline.opening_hook).
  const handleOpeningChange = useCallback(
    (opening_hook: string) => {
      const outline = draft.outline ?? { opening_hook: "", sections: [], estimated_words: 0 };
      onChange({ ...draft, outline: { ...outline, opening_hook } });
    },
    [draft, onChange],
  );

  const hasOpening = (draft.outline?.opening_hook?.trim().length ?? 0) > 0;

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

  // ── Derived ── (memoized: recomputed on section changes, not on the
  // per-token liveText re-renders that fire throughout a compose)
  const { totalWords, draftedCount, unfilledCount } = useMemo(() => {
    let words = 0;
    let drafted = 0;
    for (const s of draft.sections) {
      words += s.word_count;
      if (s.status === "ready" || s.status === "edited") drafted += 1;
    }
    return {
      totalWords: words,
      draftedCount: drafted,
      unfilledCount: draft.sections.length - drafted,
    };
  }, [draft.sections]);
  const targetWords = draft.idea.target_words ?? 1500;
  const jobRunning = jobActive || generatingIds.size > 0;

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
    // Single-pass whole-draft compose — clear single-section streaming state.
    setLiveSectionId(null);
    setLiveText("");
    setComposingWholeDraft(true);
    try {
      await onExpandAll();
    } finally {
      setAdvancing(false);
    }
  }, [onExpandAll]);

  const handleExpandUnfilled = useCallback(async () => {
    setLiveSectionId(null);
    setLiveText("");
    setComposingWholeDraft(true);
    await onExpandUnfilled();
  }, [onExpandUnfilled]);

  // Holistic revise touches many sections — clear any single-section live
  // buffer so tokens aren't misattributed to one card.
  const handleReviseDraft = useCallback(
    async (instruction: string) => {
      setLiveSectionId(null);
      setLiveText("");
      await onReviseDraft(instruction);
    },
    [onReviseDraft],
  );

  // Single-section regenerate — arm the live buffer for this section before
  // the job's token frames start arriving. `instruction` steers a guided
  // revision when the author supplied a note.
  const handleRegenerateSection = useCallback(
    async (sectionId: string, instruction?: string) => {
      setLiveSectionId(sectionId);
      setLiveText("");
      await onRegenerateSection(sectionId, instruction);
    },
    [onRegenerateSection],
  );

  const handleSaveTemplate = useCallback(async () => {
    const name = window.prompt("Template name", draft.title || "Untitled template");
    if (!name?.trim()) return;
    try {
      await createTemplateFromDraft(draft.id, name.trim());
      setTemplateMsg("Saved as template ✓");
    } catch (e) {
      setTemplateMsg(e instanceof Error ? e.message : "Failed to save template");
    }
    setTimeout(() => setTemplateMsg(null), 2800);
  }, [draft.id, draft.title]);

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
          <div className="flex items-center gap-1">
            <Link to="/" className="nb-btn nb-btn-ghost nb-btn-sm no-underline -ml-2">
              ← All drafts
            </Link>
            <button
              type="button"
              onClick={handleSaveTemplate}
              className="nb-btn nb-btn-ghost nb-btn-sm"
            >
              {templateMsg ?? "Save as template"}
            </button>
          </div>
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

        <StageNav draft={draft} onJump={onJumpStage} />

        {/* Hero — title renders its markdown (so a pasted "**Title**" shows
            bold, not literal **) and switches to an input on click to edit. */}
        <header className="mb-6">
          {titleEditing ? (
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onBlur={() => setTitleEditing(false)}
              placeholder="Untitled draft"
              // biome-ignore lint/a11y/noAutofocus: focus the field the writer just clicked
              autoFocus
              className="w-full bg-transparent border-0 px-0 py-1 font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight focus:outline-none placeholder:text-muted-2"
              aria-label="Draft title"
            />
          ) : (
            <button
              type="button"
              onClick={() => setTitleEditing(true)}
              className="block w-full text-left px-0 py-1 font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight hover:text-cobalt-700 transition-colors"
              title="Click to edit the title"
            >
              {topic.trim() ? (
                <InlineMarkdown text={topic} />
              ) : (
                <span className="text-muted-2">Untitled draft</span>
              )}
            </button>
          )}
        </header>

        {/* Setup — collapsed unless we're at the research stage */}
        <SetupDisclosure
          draft={draft}
          onChange={handleIdeaChange}
          forceOpen={draft.stage === "research"}
        />

        {/* Stage-specific body */}
        {draft.stage === "research" && (
          <ResearchPanel draft={draft} onJobComplete={onJobComplete} />
        )}

        {draft.stage === "outline" && (
          <OutlinePanel
            draft={draft}
            onChange={handleOutlineChange}
            onApplyTitle={(title) => onChange({ ...draft, title })}
            onAdvance={handleExpandAll}
            onRegenerate={handleGenerate}
            references={<ReferencesList draftId={draft.id} collapsible defaultOpen={false} />}
          />
        )}

        {draft.stage === "sections" && (
          <div className="mb-4">
            <HeroImage
              draftId={draft.id}
              heroKey={draft.hero_image_key}
              onChanged={onJobComplete}
            />
          </div>
        )}

        {draft.stage === "sections" && draft.sections.length > 0 && !inlineHintDismissed && (
          <div className="mb-4 flex items-start gap-2 text-xs text-muted">
            <p className="leading-relaxed">
              Tip: select any text in a section to rephrase, shorten, expand, or fix it with AI.
            </p>
            <button
              type="button"
              onClick={dismissInlineHint}
              className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
            >
              Got it
            </button>
          </div>
        )}

        {draft.stage === "sections" && pending.length > 0 && (
          <div className="mb-3 flex items-center justify-end">
            <button
              type="button"
              className="nb-btn nb-btn-ghost nb-btn-sm text-cobalt-700"
              onClick={() => {
                approveAll(draft.id);
                refreshPending();
              }}
            >
              Approve changes ({pending.length})
            </button>
          </div>
        )}

        {draft.stage === "sections" && (
        <Suspense
          fallback={
            <p className="text-center text-muted text-sm py-16 animate-fade-in">
              Opening the editor…
            </p>
          }
        >
        {hasOpening && (
          <OpeningCard
            value={draft.outline?.opening_hook ?? ""}
            draftId={draft.id}
            pendingTexts={pendingTextsForSection("opening")}
            onSave={handleOpeningChange}
          />
        )}
          <SectionsPanel
            draft={draft}
            generatingIds={generatingIds}
            jobError={jobError}
            onDismissJobError={() => setJobError(null)}
            unfilledCount={unfilledCount}
            jobRunning={jobRunning}
            composingWholeDraft={composingWholeDraft}
            liveWords={totalWords}
            liveSectionId={liveSectionId}
            liveText={liveText}
            onSectionSave={onSectionSave}
            pendingTextsForSection={pendingTextsForSection}
            onRegenerateSection={handleRegenerateSection}
            onRevertSection={onRevertSection}
            onReviseDraft={handleReviseDraft}
            onReorder={onReorder}
            onExpandUnfilled={handleExpandUnfilled}
            onComposeRemaining={handleExpandUnfilled}
            references={<ReferencesList draftId={draft.id} collapsible defaultOpen={false} />}
          />
        </Suspense>
        )}
      </main>

      {showFooter && (
        <WorkspaceFooter
          draft={draft}
          totalWords={totalWords}
          draftedCount={draftedCount}
          sectionCount={draft.sections.length}
          onLint={() => setLintOpen(true)}
          onRepurpose={() => setRepurposeOpen(true)}
          onHeadlines={() => setHeadlinesOpen(true)}
          onShape={() => setShapeOpen(true)}
          onGeo={() => setGeoOpen(true)}
          onHumanize={() => setHumanizeOpen(true)}
          onCheckup={() => setCheckupOpen(true)}
        />
      )}

      {/* Lazy overlay panels: null fallback — each pops in when its chunk lands. */}
      <Suspense fallback={null}>
      {lintOpen && (
        <LintPanel
          draft={draft}
          onSectionSave={onSectionSave}
          onTrackChange={handleTrackChange}
          onClose={() => setLintOpen(false)}
        />
      )}
      {shapeOpen && (
        <ShapePanel
          draft={draft}
          onSectionSave={onSectionSave}
          onClose={() => setShapeOpen(false)}
        />
      )}
      {geoOpen && (
        <OptimizePanel
          draft={draft}
          onSectionSave={onSectionSave}
          onChange={onChange}
          onClose={() => setGeoOpen(false)}
        />
      )}
      {humanizeOpen && (
        <HumanizePanel
          draft={draft}
          onSectionSave={onSectionSave}
          onClose={() => setHumanizeOpen(false)}
        />
      )}
      {checkupOpen && (
        <CheckupPanel
          draft={draft}
          onOpenReview={() => {
            setCheckupOpen(false);
            setLintOpen(true);
          }}
          onOpenGeo={() => {
            setCheckupOpen(false);
            setGeoOpen(true);
          }}
          onOpenShape={() => {
            setCheckupOpen(false);
            setShapeOpen(true);
          }}
          onOpenHumanize={() => {
            setCheckupOpen(false);
            setHumanizeOpen(true);
          }}
          onClose={() => setCheckupOpen(false)}
        />
      )}
      {repurposeOpen && (
        <RepurposePanel draftId={draft.id} onClose={() => setRepurposeOpen(false)} />
      )}
      {headlinesOpen && (
        <HeadlineLab
          draftId={draft.id}
          onApplyTitle={(title) => onChange({ ...draft, title })}
          onApplyHook={(hook) =>
            onChange(
              draft.outline
                ? { ...draft, outline: { ...draft.outline, opening_hook: hook } }
                : draft,
            )
          }
          onClose={() => setHeadlinesOpen(false)}
        />
      )}
      </Suspense>
    </div>
  );
}
