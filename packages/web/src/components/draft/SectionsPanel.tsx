import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Draft, Section } from "../../api/drafts";
import { DraftReadView } from "./DraftReadView";
import { SectionCard } from "./SectionCard";

interface SectionsPanelProps {
  draft: Draft;
  generatingIds: Set<string>;
  jobError: { message: string; hint?: string } | null;
  onDismissJobError: () => void;
  unfilledCount: number;
  jobRunning: boolean;
  /** True while a single-pass whole-draft compose is running — show one
   * unified "writing the full draft" state instead of per-section spinners. */
  composingWholeDraft?: boolean;
  /** Live total word count (sum of section word_counts) — drives the compose
   * theater's word ticker. Owned by the workspace so it matches the footer. */
  liveWords?: number;
  /** Section currently streaming live prose (single-section regenerate). */
  liveSectionId?: string | null;
  /** Accumulated live token text for liveSectionId. */
  liveText?: string;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  /** Unapproved panel-applied runs to color, per section id. */
  pendingTextsForSection?: (sectionId: string) => string[];
  onRegenerateSection: (sectionId: string, instruction?: string) => Promise<void>;
  onRevertSection: (sectionId: string, versionId: string) => Promise<void>;
  onReorder: (section_ids: string[]) => Promise<void>;
  /** Compose the whole post in a single pass from the outline. */
  onExpandUnfilled: () => Promise<void>;
  /** Fill only the still-unwritten sections — used to recover from a partial
   * compose failure without re-composing (and re-paying for) the whole draft. */
  onComposeRemaining: () => Promise<void>;
  /** Holistic, whole-draft revision against a single author instruction. */
  onReviseDraft: (instruction: string) => Promise<void>;
  /** Optional right-rail block, typically a collapsible ReferencesList. */
  references?: React.ReactNode;
}

export function SectionsPanel({
  draft,
  generatingIds,
  jobError,
  onDismissJobError,
  unfilledCount,
  jobRunning,
  composingWholeDraft = false,
  liveWords: liveWordsProp,
  liveSectionId,
  liveText,
  onSectionSave,
  pendingTextsForSection,
  onRegenerateSection,
  onRevertSection,
  onReorder,
  onExpandUnfilled,
  onComposeRemaining,
  onReviseDraft,
  references,
}: SectionsPanelProps): JSX.Element {
  const [view, setView] = useState<"edit" | "read">("edit");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState("");
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  // Optimistic section order, applied immediately on reorder and reconciled
  // when the server-backed `draft` prop updates. `null` = use the server order.
  const [optimisticSections, setOptimisticSections] = useState<Section[] | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  // Reset the optimistic override whenever the server order changes so we never
  // show stale local state once the parent re-renders with fresh sections.
  const serverOrderKey = draft.sections.map((s) => s.id).join(",");
  const lastServerOrderKey = useRef(serverOrderKey);
  useEffect(() => {
    if (lastServerOrderKey.current !== serverOrderKey) {
      lastServerOrderKey.current = serverOrderKey;
      setOptimisticSections(null);
    }
  }, [serverOrderKey]);

  const sections = optimisticSections ?? draft.sections;

  // Stable identity (reads the latest order through a ref) so the per-section
  // handler bundle below survives unrelated re-renders — the point is that
  // token-streaming state changes don't re-render every memoized SectionCard.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const moveSection = useCallback(
    async (idx: number, dir: -1 | 1): Promise<void> => {
      const cur = sectionsRef.current;
      const swap = idx + dir;
      if (swap < 0 || swap >= cur.length) return;
      const next = [...cur];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      // Optimistic: reorder locally now so the list responds instantly.
      setOptimisticSections(next);
      setReorderError(null);
      try {
        await onReorder(next.map((s) => s.id));
        // Success: drop the override; the parent prop carries the server truth.
        setOptimisticSections(null);
      } catch (e) {
        // Reject: roll back to the server order and surface the failure.
        setOptimisticSections(null);
        setReorderError(e instanceof Error ? e.message : String(e));
      }
    },
    [onReorder],
  );

  // Per-section handler bundle, recreated only when the section list itself
  // (or a parent handler) changes — NOT on every liveText token. Combined with
  // memo(SectionCard), a streaming token re-renders only the active card.
  const cardProps = useMemo(
    () =>
      sections.map((section, i) => ({
        pendingTexts: pendingTextsForSection?.(section.id),
        onSave: (md: string, createVersion?: boolean) =>
          onSectionSave(section.id, md, createVersion),
        onRegenerate: (instruction?: string) => onRegenerateSection(section.id, instruction),
        onRevert: (versionId: string) => onRevertSection(section.id, versionId),
        onMoveUp: () => moveSection(i, -1),
        onMoveDown: () => moveSection(i, 1),
      })),
    [sections, pendingTextsForSection, onSectionSave, onRegenerateSection, onRevertSection, moveSection],
  );

  const total = sections.length;
  const doneCount = sections.filter((s) => s.status === "ready" || s.status === "edited").length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const writtenCount = doneCount;
  // Live word tally for the compose theater — sums each section's word_count as
  // it fills, so the ticker climbs section-by-section as the draft lands. Prefer
  // the workspace-owned total (matches the footer) when supplied.
  const liveWords = liveWordsProp ?? sections.reduce((acc, s) => acc + s.word_count, 0);

  const submitRevise = async (): Promise<void> => {
    const note = reviseNote.trim();
    if (!note) return;
    setRevising(true);
    setReviseError(null);
    // Switch to the section view so per-section streaming is visible.
    setView("edit");
    try {
      await onReviseDraft(note);
      setReviseOpen(false);
      setReviseNote("");
    } catch (e) {
      setReviseError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevising(false);
    }
  };

  return (
    <section className="space-y-4 animate-fade-up">
      {references}

      {total > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-nb-sm border border-rule overflow-hidden">
            <button
              type="button"
              onClick={() => setView("edit")}
              aria-pressed={view === "edit"}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "edit"
                  ? "bg-cobalt-50 text-cobalt-700"
                  : "bg-card text-muted hover:text-ink"
              }`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setView("read")}
              aria-pressed={view === "read"}
              className={`px-3 py-1.5 text-sm font-medium border-l border-rule transition-colors ${
                view === "read"
                  ? "bg-cobalt-50 text-cobalt-700"
                  : "bg-card text-muted hover:text-ink"
              }`}
            >
              Read
            </button>
          </div>
          {writtenCount > 0 && (
            <button
              type="button"
              onClick={() => setReviseOpen((v) => !v)}
              disabled={jobRunning}
              aria-expanded={reviseOpen}
              className="nb-btn nb-btn-sm"
            >
              Revise whole draft…
            </button>
          )}
        </div>
      )}

      {reviseOpen && writtenCount > 0 && (
        <div className="nb-card p-4 animate-fade-in">
          <label
            htmlFor="revise-note"
            className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5"
          >
            Revise the whole draft
          </label>
          <p className="text-xs text-muted mb-2">
            One instruction, applied across every written section with the full draft as context —
            e.g. “smooth the transitions”, “tighten throughout”, “make the tone more casual”.
          </p>
          <textarea
            id="revise-note"
            value={reviseNote}
            onChange={(e) => setReviseNote(e.target.value)}
            rows={2}
            placeholder="How should I revise the whole piece?"
            className="w-full bg-canvas border border-rule rounded-nb-sm px-3 py-2 text-sm text-ink placeholder:text-muted-2 focus:outline-none focus:border-cobalt-300 resize-y"
          />
          {reviseError && <p className="mt-2 text-xs text-rose-ink">{reviseError}</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setReviseOpen(false)}
              className="nb-btn nb-btn-ghost nb-btn-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitRevise}
              disabled={revising || jobRunning || !reviseNote.trim()}
              className="nb-btn nb-btn-primary nb-btn-sm"
            >
              {revising
                ? "Starting…"
                : `Revise ${writtenCount} section${writtenCount === 1 ? "" : "s"} →`}
            </button>
          </div>
        </div>
      )}

      {composingWholeDraft && (
        <output
          className="block px-5 py-4 rounded-nb compose-theater-banner"
          style={{
            background: "linear-gradient(135deg, #eaf0ff 0%, #f3f0ff 100%)",
            border: "1px solid #c2d4ff",
          }}
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-cobalt-700">
              <span aria-hidden className="compose-theater-quill">
                ✍
              </span>
              Writing in your voice…
            </span>
            <span className="flex items-center gap-3 font-mono text-xs text-cobalt-700">
              <span>
                {doneCount} of {total} sections
              </span>
              <span
                aria-hidden
                className="inline-block w-px h-3.5 self-center"
                style={{ background: "#c2d4ff" }}
              />
              <span className="tabular-nums text-amber-ink font-semibold">
                {liveWords.toLocaleString()} {liveWords === 1 ? "word" : "words"}
              </span>
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#c2d4ff" }}>
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${pct}%`, background: "var(--cobalt-500, #2f6bff)" }}
            />
          </div>
        </output>
      )}

      {jobRunning && !composingWholeDraft && (
        <output
          className="block px-5 py-4 rounded-nb"
          style={{ background: "#eaf0ff", border: "1px solid #c2d4ff" }}
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-cobalt-700">
              <span
                aria-hidden
                className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
              />
              Composing your draft…
            </span>
            <span className="font-mono text-xs text-cobalt-700">
              {doneCount} / {total} sections
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#c2d4ff" }}>
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%`, background: "var(--cobalt-500, #2f6bff)" }}
            />
          </div>
        </output>
      )}

      {unfilledCount > 0 && (
        <div
          className="flex items-center justify-between gap-3 px-5 py-3.5 rounded-nb"
          style={{ background: "#eaf0ff", border: "1px solid #c2d4ff" }}
        >
          <div className="text-sm text-cobalt-700">
            <strong className="font-semibold">
              {unfilledCount} section{unfilledCount === 1 ? "" : "s"} unwritten.
            </strong>{" "}
            Compose the whole post in one pass.
          </div>
          {!jobRunning && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onExpandUnfilled()}
                className="nb-btn nb-btn-primary nb-btn-sm"
              >
                Compose draft →
              </button>
            </div>
          )}
        </div>
      )}

      {jobError && (
        <div
          className="px-4 py-3 rounded-nb"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider">Generation failed</p>
          <p className="text-sm mt-1">
            {writtenCount > 0
              ? `Composed ${writtenCount} of ${total} section${total === 1 ? "" : "s"}, then failed: ${jobError.message}`
              : jobError.message}
          </p>
          {jobError.hint && <p className="text-xs mt-1 opacity-80">{jobError.hint}</p>}
          <div className="mt-2 flex items-center gap-3">
            {unfilledCount > 0 && !jobRunning && (
              <button
                type="button"
                onClick={() => onComposeRemaining()}
                className="nb-btn nb-btn-primary nb-btn-sm"
              >
                Compose remaining →
              </button>
            )}
            <button
              type="button"
              onClick={onDismissJobError}
              className="text-xs font-medium underline underline-offset-2 hover:no-underline"
            >
              dismiss
            </button>
          </div>
        </div>
      )}

      {reorderError && (
        <div
          className="px-4 py-3 rounded-nb"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider">Reorder failed</p>
          <p className="text-sm mt-1">{reorderError}</p>
          <button
            type="button"
            onClick={() => setReorderError(null)}
            className="mt-2 text-xs font-medium underline underline-offset-2 hover:no-underline"
          >
            dismiss
          </button>
        </div>
      )}

      {sections.length === 0 && !composingWholeDraft && (
        <p className="nb-card p-8 text-center italic text-muted">No sections yet.</p>
      )}

      {composingWholeDraft ? (
        <ComposingDraftPanel sections={sections} generatingIds={generatingIds} />
      ) : view === "read" ? (
        <DraftReadView draft={draft} />
      ) : (
        <div className="space-y-3">
          {sections.map((section, i) => {
            const isComposing = generatingIds.has(section.id);
            const hasLanded = section.status === "ready" || section.status === "edited";
            // The celebratory landing pop should only fire during an active job —
            // a static, fully-written draft shouldn't pop every card on render.
            return (
              <div
                key={section.id}
                className={`rounded-[14px] transition-shadow duration-500 ${
                  isComposing
                    ? "section-card-composing"
                    : jobRunning && hasLanded
                      ? "section-card-landed"
                      : ""
                }`}
              >
                <SectionCard
                  section={section}
                  index={i}
                  isGenerating={isComposing}
                  liveText={liveSectionId === section.id ? liveText : undefined}
                  draftId={draft.id}
                  pendingTexts={cardProps[i].pendingTexts}
                  onSave={cardProps[i].onSave}
                  onRegenerate={cardProps[i].onRegenerate}
                  onRevert={cardProps[i].onRevert}
                  onMoveUp={cardProps[i].onMoveUp}
                  onMoveDown={cardProps[i].onMoveDown}
                  canMoveUp={i > 0}
                  canMoveDown={i < sections.length - 1}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The compose "theater": shown while the whole post is written in a single
 * pass. One unified state — not N spinning cards — so it reads as "writing one
 * document". Each outline title lights up as it composes (pulsing cobalt) and
 * lands (a celebratory fade-in with a check), so the author watches the draft
 * fill in real time. */
function ComposingDraftPanel({
  sections,
  generatingIds,
}: {
  sections: Section[];
  generatingIds: Set<string>;
}): JSX.Element {
  return (
    <output
      className="block nb-card p-8 text-center animate-fade-in"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center justify-center gap-3 text-cobalt-700">
        <span
          aria-hidden
          className="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"
        />
        <span className="font-serif text-xl font-medium tracking-tight">
          Composing your full draft…
        </span>
      </div>
      <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
        Writing the whole post in one pass from your outline, so it reads as a single coherent
        piece. Watch each section land below.
      </p>
      {sections.length > 0 && (
        <ul className="mt-5 inline-flex flex-col gap-1 text-left">
          {sections.map((s) => {
            const landed = s.status === "ready" || s.status === "edited";
            const composing = generatingIds.has(s.id);
            return (
              <li
                key={s.id}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-nb-sm text-sm transition-all duration-500 ${
                  landed
                    ? "compose-line-landed text-ink font-medium"
                    : composing
                      ? "compose-line-active text-cobalt-700 font-medium"
                      : "text-muted-2"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid place-items-center w-4 h-4 shrink-0 ${
                    composing ? "compose-quill-pulse text-cobalt-500" : ""
                  }`}
                >
                  {landed ? (
                    <span className="text-leaf compose-check-pop">✓</span>
                  ) : composing ? (
                    "✍"
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-cobalt-300" />
                  )}
                </span>
                <span className="truncate">{s.title}</span>
                {landed && s.word_count > 0 && (
                  <span className="ml-auto pl-2 font-mono text-[11px] text-muted-2 tabular-nums">
                    {s.word_count.toLocaleString()}w
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </output>
  );
}
