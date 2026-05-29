import { useState } from "react";

import type { Draft } from "../../api/drafts";
import { DraftReadView } from "./DraftReadView";
import { SectionCard } from "./SectionCard";

interface SectionsPanelProps {
  draft: Draft;
  generatingIds: Set<string>;
  jobError: { message: string; hint?: string } | null;
  onDismissJobError: () => void;
  unfilledCount: number;
  jobRunning: boolean;
  /** Section currently streaming live prose (single-section regenerate). */
  liveSectionId?: string | null;
  /** Accumulated live token text for liveSectionId. */
  liveText?: string;
  onSectionSave: (sectionId: string, content_md: string) => Promise<void>;
  onRegenerateSection: (sectionId: string, instruction?: string) => Promise<void>;
  onRevertSection: (sectionId: string, versionId: string) => Promise<void>;
  onReorder: (section_ids: string[]) => Promise<void>;
  onExpandUnfilled: () => Promise<void>;
  /** Incremental drafting — compose only the next N unwritten sections. */
  onExpandNext: (n: number) => Promise<void>;
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
  liveSectionId,
  liveText,
  onSectionSave,
  onRegenerateSection,
  onRevertSection,
  onReorder,
  onExpandUnfilled,
  onExpandNext,
  onReviseDraft,
  references,
}: SectionsPanelProps): JSX.Element {
  const NEXT_BATCH = 3;
  const [view, setView] = useState<"edit" | "read">("edit");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState("");
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);

  const moveSection = async (idx: number, dir: -1 | 1): Promise<void> => {
    const ids = draft.sections.map((s) => s.id);
    const swap = idx + dir;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    await onReorder(ids).catch(() => {});
  };

  const total = draft.sections.length;
  const doneCount = draft.sections.filter(
    (s) => s.status === "ready" || s.status === "edited",
  ).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const writtenCount = doneCount;

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

      {jobRunning && (
        <output
          className="block px-5 py-4 rounded-nb"
          style={{ background: "#eef2ff", border: "1px solid #c9d4fd" }}
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
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#c9d4fd" }}>
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%`, background: "var(--cobalt-500, #3b5bdb)" }}
            />
          </div>
        </output>
      )}

      {unfilledCount > 0 && (
        <div
          className="flex items-center justify-between gap-3 px-5 py-3.5 rounded-nb"
          style={{ background: "#eaeefe", border: "1px solid #c9d4fd" }}
        >
          <div className="text-sm text-cobalt-700">
            <strong className="font-semibold">
              {unfilledCount} section{unfilledCount === 1 ? "" : "s"} unwritten.
            </strong>{" "}
            Compose them all in one go.
          </div>
          {!jobRunning && (
            <div className="flex items-center gap-2 shrink-0">
              {unfilledCount > NEXT_BATCH && (
                <button
                  type="button"
                  onClick={() => onExpandNext(NEXT_BATCH)}
                  className="nb-btn nb-btn-sm"
                >
                  Draft next {NEXT_BATCH} →
                </button>
              )}
              <button
                type="button"
                onClick={() => onExpandUnfilled()}
                className="nb-btn nb-btn-primary nb-btn-sm"
              >
                Compose {unfilledCount > NEXT_BATCH ? `all ${unfilledCount}` : unfilledCount} →
              </button>
            </div>
          )}
        </div>
      )}

      {jobError && (
        <div
          className="px-4 py-3 rounded-nb"
          style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider">Generation failed</p>
          <p className="text-sm mt-1">{jobError.message}</p>
          {jobError.hint && <p className="text-xs mt-1 opacity-80">{jobError.hint}</p>}
          <button
            type="button"
            onClick={onDismissJobError}
            className="mt-2 text-xs font-medium underline underline-offset-2 hover:no-underline"
          >
            dismiss
          </button>
        </div>
      )}

      {draft.sections.length === 0 && (
        <p className="nb-card p-8 text-center italic text-muted">No sections yet.</p>
      )}

      {view === "read" ? (
        <DraftReadView draft={draft} />
      ) : (
        <div className="space-y-3">
          {draft.sections.map((section, i) => (
            <SectionCard
              key={section.id}
              section={section}
              index={i}
              isGenerating={generatingIds.has(section.id)}
              liveText={liveSectionId === section.id ? liveText : undefined}
              draftId={draft.id}
              onSave={(md) => onSectionSave(section.id, md)}
              onRegenerate={(instruction) => onRegenerateSection(section.id, instruction)}
              onRevert={(versionId) => onRevertSection(section.id, versionId)}
              onMoveUp={() => moveSection(i, -1)}
              onMoveDown={() => moveSection(i, 1)}
              canMoveUp={i > 0}
              canMoveDown={i < draft.sections.length - 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}
