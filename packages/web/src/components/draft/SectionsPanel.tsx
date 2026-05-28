import type { Draft } from "../../api/drafts";
import { SectionCard } from "./SectionCard";

interface SectionsPanelProps {
  draft: Draft;
  generatingIds: Set<string>;
  jobError: { message: string; hint?: string } | null;
  onDismissJobError: () => void;
  unfilledCount: number;
  jobRunning: boolean;
  onSectionSave: (sectionId: string, content_md: string) => Promise<void>;
  onRegenerateSection: (sectionId: string) => Promise<void>;
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
  onSectionSave,
  onRegenerateSection,
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

  return (
    <section className="space-y-4 animate-fade-up">
      {references}

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
          {jobRunning ? (
            <span className="flex items-center gap-2 text-sm font-medium text-amber">
              <span
                aria-hidden
                className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
              />
              Composing {generatingIds.size}…
            </span>
          ) : (
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
            onSave={(md) => onSectionSave(section.id, md)}
            onRegenerate={() => onRegenerateSection(section.id)}
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
