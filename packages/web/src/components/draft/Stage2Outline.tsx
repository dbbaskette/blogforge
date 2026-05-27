import { useCallback, useState } from "react";

import type { Draft, OutlineProposal, OutlineSection } from "../../api/drafts";
import { useDebouncedSave } from "../../hooks/useDebouncedSave";
import { OutlineSectionCard } from "./OutlineSectionCard";
import { Field, Spinner, StageHeader } from "./Stage1Idea";

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
    <div className="space-y-6 animate-fade-up">
      <StageHeader
        eyebrow="Stage 02 · The outline"
        title="Shape the bones."
        subline="A hook to start, then the sections. Reorder, rewrite, regenerate. Nothing's set yet."
        saving={saving}
        saveError={saveError}
      />

      <Field label="Opening hook" id="s2-hook">
        <textarea
          id="s2-hook"
          value={openingHook}
          onChange={(e) => setOpeningHook(e.target.value)}
          placeholder="A compelling opening sentence or paragraph…"
          rows={3}
          className="w-full bg-ink border border-rule rounded-sm px-3 py-2.5 text-cream font-prose text-base placeholder:text-muted-2 focus:border-vermilion-400 focus:outline-none transition-colors resize-none"
        />
      </Field>

      <section>
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="font-display text-cream-2 text-xl tracking-tight-2">
            Sections{" "}
            <span className="font-mono-num text-muted text-base ml-1">
              ({sections.length.toString().padStart(2, "0")})
            </span>
          </h3>
          <button
            type="button"
            onClick={addSection}
            className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400 hover:text-vermilion-300 transition-colors"
          >
            + add section
          </button>
        </div>

        {sections.length === 0 && (
          <p className="font-prose italic text-muted text-sm text-center py-10 border-t border-rule">
            No sections yet. Add one, or regenerate the outline.
          </p>
        )}

        <div>
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
          {sections.length > 0 && <div className="rule" />}
        </div>
      </section>

      {actionError && (
        <p className="text-vermilion-300 text-sm border-l-2 border-vermilion pl-3">{actionError}</p>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-rule">
        <button type="button" onClick={onBack} className="btn-press">
          ← Back
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating || advancing}
          className="btn-press"
        >
          {regenerating ? (
            <>
              <Spinner /> Regenerating…
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
          className="btn-stamp"
        >
          {advancing ? (
            <>
              <Spinner /> Starting…
            </>
          ) : (
            <>Expand all sections →</>
          )}
        </button>
      </div>
    </div>
  );
}
