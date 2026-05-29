import { useState } from "react";

import type { Draft, OutlineProposal, OutlineSection } from "../../api/drafts";
import { Icon } from "../ui/Icon";

function newSection(): OutlineSection {
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    title: "New section",
    brief: "",
  };
}

interface OutlinePanelProps {
  draft: Draft;
  onChange: (outline: OutlineProposal) => void;
  onAdvance: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  /** Optional right-rail block, typically a collapsible ReferencesList. */
  references?: React.ReactNode;
}

export function OutlinePanel({
  draft,
  onChange,
  onAdvance,
  onRegenerate,
  references,
}: OutlinePanelProps): JSX.Element {
  const outline = draft.outline ?? { opening_hook: "", sections: [], estimated_words: 0 };
  const [advancing, setAdvancing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateSection = (idx: number, patch: Partial<OutlineSection>): void => {
    onChange({
      ...outline,
      sections: outline.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  };
  const removeSection = (idx: number): void => {
    onChange({ ...outline, sections: outline.sections.filter((_, i) => i !== idx) });
  };
  const moveSection = (idx: number, dir: -1 | 1): void => {
    const next = [...outline.sections];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange({ ...outline, sections: next });
  };
  const addSection = (): void => {
    onChange({ ...outline, sections: [...outline.sections, newSection()] });
  };

  const handleAdvance = async (): Promise<void> => {
    setAdvancing(true);
    setError(null);
    try {
      await onAdvance();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdvancing(false);
    }
  };

  const handleRegenerate = async (): Promise<void> => {
    setRegenerating(true);
    setError(null);
    try {
      await onRegenerate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <section className="space-y-5 animate-fade-up">
      <header className="nb-card p-7">
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
          Step 2 · The outline
        </p>
        <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">
          Shape the bones.
        </h2>
        <p className="text-sm text-muted mt-1.5 leading-relaxed">
          BlogForge drafted an opening and a section list from your idea. Edit, reorder, or
          regenerate. When it feels right, compose.
        </p>

        <div className="mt-5">
          <label htmlFor="hook" className="nb-label">
            Opening hook
          </label>
          <textarea
            id="hook"
            value={outline.opening_hook}
            onChange={(e) => onChange({ ...outline, opening_hook: e.target.value })}
            placeholder="A compelling opening sentence or paragraph…"
            rows={3}
            className="nb-textarea font-serif text-[15px]"
          />
        </div>
      </header>

      {references}

      <div>
        <div className="flex items-baseline justify-between mb-2 px-1">
          <h3 className="font-serif text-lg font-medium text-ink tracking-tight">
            Sections{" "}
            <span className="font-mono text-sm text-muted">
              ({outline.sections.length.toString().padStart(2, "0")})
            </span>
          </h3>
          <button
            type="button"
            onClick={addSection}
            className="text-xs font-medium text-cobalt-600 hover:text-cobalt-700"
          >
            + Add section
          </button>
        </div>

        {outline.sections.length === 0 && (
          <p className="nb-card p-8 text-center italic text-muted">
            No sections yet. Add one, or regenerate the outline.
          </p>
        )}

        <div className="space-y-2">
          {outline.sections.map((s, i) => (
            <article key={s.id} className="group nb-card nb-card-hover p-4">
              <div className="grid grid-cols-[32px_1fr_auto] gap-3 items-start">
                <span className="w-7 h-7 rounded-nb-sm bg-canvas grid place-items-center font-mono text-[11px] font-medium text-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="space-y-1.5 min-w-0">
                  <input
                    type="text"
                    value={s.title}
                    onChange={(e) => updateSection(i, { title: e.target.value })}
                    placeholder="Section title"
                    className="w-full bg-transparent border-0 border-b border-transparent hover:border-rule focus:border-cobalt-500 px-0 py-0.5 font-serif text-lg font-medium text-ink tracking-tight focus:outline-none transition-colors"
                  />
                  <textarea
                    value={s.brief}
                    onChange={(e) => updateSection(i, { brief: e.target.value })}
                    placeholder="What does this section do? A sentence or two."
                    rows={2}
                    className="w-full bg-transparent border-0 border-l-2 border-rule pl-3 py-0.5 font-serif italic text-[14px] text-muted leading-snug focus:border-cobalt-400 focus:outline-none resize-none transition-colors"
                  />
                </div>
                <div className="flex flex-col items-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => moveSection(i, -1)}
                    disabled={i === 0}
                    className="nb-icon-btn"
                    aria-label="Move up"
                  >
                    <Icon name="chevron-up" size={14} title="" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, 1)}
                    disabled={i === outline.sections.length - 1}
                    className="nb-icon-btn"
                    aria-label="Move down"
                  >
                    <Icon name="chevron-down" size={14} title="" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(i)}
                    className="nb-icon-btn hover:!text-rose"
                    aria-label="Remove"
                  >
                    <Icon name="x" size={14} title="" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      {error && (
        <p
          className="text-sm px-3 py-2 rounded-nb-sm"
          style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-rule">
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating || advancing}
          className="nb-btn"
        >
          {regenerating ? "Regenerating…" : "Regenerate outline"}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleAdvance}
          disabled={outline.sections.length === 0 || advancing || regenerating}
          className="nb-btn nb-btn-primary"
        >
          {advancing ? "Starting…" : `Compose ${outline.sections.length} sections →`}
        </button>
      </div>
    </section>
  );
}
