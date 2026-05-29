import type { Draft } from "../../api/drafts";
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
  references,
}: SectionsPanelProps): JSX.Element {
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

  return (
    <section className="space-y-4 animate-fade-up">
      {references}

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
            <button
              type="button"
              onClick={() => onExpandUnfilled()}
              className="nb-btn nb-btn-primary nb-btn-sm"
            >
              Compose {unfilledCount} unfilled →
            </button>
          )}
        </div>
      )}

      {jobError && (
        <div
          className="px-4 py-3 rounded-nb"
          style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider">Expand failed</p>
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
    </section>
  );
}
