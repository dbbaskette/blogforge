import { useState } from "react";

import type { Section } from "../../api/drafts";
import { MarkdownEditor } from "./MarkdownEditor";

interface SectionCardProps {
  section: Section;
  isGenerating: boolean;
  onSave: (content_md: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
}

function StatusIcon({ status }: { status: Section["status"] }): JSX.Element {
  const map: Record<Section["status"], { icon: string; cls: string }> = {
    empty: { icon: "○", cls: "text-slate-500" },
    generating: { icon: "●", cls: "text-amber-400 animate-pulse" },
    ready: { icon: "✓", cls: "text-emerald-400" },
    failed: { icon: "✗", cls: "text-red-400" },
    edited: { icon: "✎", cls: "text-blue-400" },
  };
  const { icon, cls } = map[status] ?? { icon: "?", cls: "text-slate-500" };
  return <span className={`font-mono text-sm ${cls}`}>{icon}</span>;
}

export function SectionCard({
  section,
  isGenerating,
  onSave,
  onRegenerate,
}: SectionCardProps): JSX.Element {
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const effectiveGenerating = isGenerating || section.status === "generating";

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
    <div className="bg-slate-900 border border-slate-800 rounded overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3">
        <StatusIcon status={effectiveGenerating ? "generating" : section.status} />
        <h3 className="font-medium text-slate-100 flex-1">{section.title}</h3>
        {section.word_count > 0 && (
          <span className="text-xs text-slate-500">{section.word_count} words</span>
        )}
      </div>

      {section.brief && (
        <div className="px-4 py-2 bg-slate-950/30 text-xs text-slate-400 italic">
          {section.brief}
        </div>
      )}

      {effectiveGenerating ? (
        <div className="px-4 py-6 flex items-center gap-3 text-slate-400">
          <span className="inline-block w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Generating section content…</span>
        </div>
      ) : (
        <div className="p-4">
          <MarkdownEditor initialMarkdown={section.content_md} onSave={onSave} />
        </div>
      )}

      {regenError && <p className="px-4 pb-3 text-red-400 text-xs">{regenError}</p>}

      <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating || effectiveGenerating}
          className="px-3 py-1 text-xs border border-slate-700 rounded text-slate-300 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1"
        >
          {regenerating ? (
            <>
              <span className="inline-block w-2.5 h-2.5 border border-slate-400 border-t-transparent rounded-full animate-spin" />
              Regenerating…
            </>
          ) : (
            "Regenerate"
          )}
        </button>
      </div>
    </div>
  );
}
