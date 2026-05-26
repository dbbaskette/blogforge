import { useCallback, useState } from "react";

import type { Draft, OutlineProposal, OutlineSection } from "../../api/drafts";
import { useDebouncedSave } from "../../hooks/useDebouncedSave";
import { OutlineSectionCard } from "./OutlineSectionCard";

function makeSection(): OutlineSection {
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    title: "New section",
    brief: "",
  };
}

interface Stage2OutlineProps {
  draft: Draft;
  onChange: (updated: Draft) => Promise<void>;
  onAdvance: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  onBack: () => void;
}

export function Stage2Outline({
  draft,
  onChange,
  onAdvance,
  onRegenerate,
  onBack,
}: Stage2OutlineProps): JSX.Element {
  const outline = draft.outline ?? { opening_hook: "", sections: [], estimated_words: 0 };
  const [openingHook, setOpeningHook] = useState(outline.opening_hook);
  const [sections, setSections] = useState<OutlineSection[]>(outline.sections);
  const [advancing, setAdvancing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const buildDraft = useCallback((): Draft => {
    const updatedOutline: OutlineProposal = {
      ...outline,
      opening_hook: openingHook,
      sections,
    };
    return { ...draft, outline: updatedOutline };
  }, [draft, outline, openingHook, sections]);

  const draftValue = buildDraft();
  const { saving, error: saveError } = useDebouncedSave(draftValue, onChange, 600);

  const updateSection = (idx: number, updated: OutlineSection) => {
    setSections((prev) => prev.map((s, i) => (i === idx ? updated : s)));
  };

  const removeSection = (idx: number) => {
    setSections((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    setSections((prev) => {
      const next = [...prev];
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  };

  const addSection = () => {
    setSections((prev) => [...prev, makeSection()]);
  };

  const handleAdvance = async () => {
    setAdvancing(true);
    setActionError(null);
    try {
      await onAdvance();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdvancing(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    setActionError(null);
    try {
      await onRegenerate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Outline</h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {saving && <span>Saving…</span>}
          {saveError && <span className="text-red-400">{saveError}</span>}
        </div>
      </div>

      <div>
        <label htmlFor="s2-hook" className="block text-sm font-medium text-slate-200 mb-1">
          Opening hook
        </label>
        <textarea
          id="s2-hook"
          value={openingHook}
          onChange={(e) => setOpeningHook(e.target.value)}
          placeholder="A compelling opening sentence or paragraph…"
          rows={3}
          className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 text-sm resize-none"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Sections ({sections.length})</h3>
          <button
            type="button"
            onClick={addSection}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            + Add section
          </button>
        </div>
        {sections.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-4">
            No sections yet. Add one or regenerate the outline.
          </p>
        )}
        {sections.map((s, i) => (
          <OutlineSectionCard
            key={s.id}
            section={s}
            index={i}
            total={sections.length}
            onChange={(updated) => updateSection(i, updated)}
            onRemove={() => removeSection(i)}
            onMoveUp={() => moveSection(i, -1)}
            onMoveDown={() => moveSection(i, 1)}
          />
        ))}
      </div>

      {actionError && <p className="text-red-400 text-sm">{actionError}</p>}

      <div className="flex items-center gap-3 pt-2 border-t border-slate-800">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 text-sm border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating || advancing}
          className="px-3 py-1.5 text-sm border border-slate-700 rounded text-slate-300 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
        >
          {regenerating ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              Regenerating…
            </>
          ) : (
            "Regenerate outline"
          )}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleAdvance}
          disabled={sections.length === 0 || advancing || regenerating}
          className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-50 flex items-center gap-2"
        >
          {advancing ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Starting…
            </>
          ) : (
            "Expand all sections →"
          )}
        </button>
      </div>
    </div>
  );
}
