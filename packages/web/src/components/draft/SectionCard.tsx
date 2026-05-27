import { useState } from "react";

import type { Section } from "../../api/drafts";
import { MarkdownEditor } from "./MarkdownEditor";
import { Spinner } from "./Stage1Idea";

interface SectionCardProps {
  section: Section;
  index: number;
  isGenerating: boolean;
  onSave: (content_md: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
}

function StatusChip({ status }: { status: Section["status"] }): JSX.Element {
  const map: Record<Section["status"], { label: string; cls: string }> = {
    empty: { label: "Unwritten", cls: "chip chip-muted" },
    generating: { label: "Composing", cls: "chip chip-gold" },
    ready: { label: "Ready", cls: "chip chip-teal" },
    failed: { label: "Failed", cls: "chip chip-vermilion" },
    edited: { label: "Edited", cls: "chip chip-teal" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "chip" };
  return <span className={cls}>{label}</span>;
}

export function SectionCard({
  section,
  index,
  isGenerating,
  onSave,
  onRegenerate,
}: SectionCardProps): JSX.Element {
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const effectiveGenerating = isGenerating || section.status === "generating";
  const displayStatus: Section["status"] = effectiveGenerating ? "generating" : section.status;

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenError(null);
    try {
      await onRegenerate();
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <article className="border border-rule rounded-sm overflow-hidden bg-surface/40 transition-colors hover:border-rule-2">
      {/* Header: numeral + title + chips */}
      <header className="px-5 pt-5 pb-4 border-b border-rule">
        <div className="grid grid-cols-[3rem_1fr_auto] gap-4 items-start">
          <span className="font-display-tight font-mono-num text-muted-2 text-3xl leading-none">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-cream-2 text-2xl leading-tight tracking-tight-2">
              {section.title}
            </h3>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <StatusChip status={displayStatus} />
              {section.word_count > 0 && (
                <span className="font-mono text-[11px] text-muted">
                  {section.word_count.toLocaleString()} words
                </span>
              )}
            </div>
          </div>
        </div>
        {section.brief && (
          <p className="mt-3 pl-[3.5rem] font-prose italic text-cream/65 text-sm leading-relaxed">
            {section.brief}
          </p>
        )}
      </header>

      {effectiveGenerating ? (
        <div className="px-5 py-10 flex items-center justify-center gap-3 text-gold">
          <Spinner />
          <span className="font-mono text-[11px] uppercase tracking-wide-3">
            Setting type — composing section…
          </span>
        </div>
      ) : (
        <div className="p-5">
          <MarkdownEditor initialMarkdown={section.content_md} onSave={onSave} />
        </div>
      )}

      {regenError && (
        <p className="mx-5 mb-3 text-vermilion-300 text-xs border-l-2 border-vermilion pl-3">
          {regenError}
        </p>
      )}

      <footer className="px-5 py-3 border-t border-rule flex items-center justify-end gap-2 bg-surface/60">
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating || effectiveGenerating}
          className="btn-press text-xs"
        >
          {regenerating ? (
            <>
              <Spinner /> Regenerating…
            </>
          ) : (
            "Regenerate"
          )}
        </button>
      </footer>
    </article>
  );
}
