import { useCallback, useEffect, useState } from "react";

import type { Draft, IdeaInput } from "../../api/drafts";
import { type PackSummary, listPacks } from "../../api/packs";
import { type ModelInfo, listModels, listProviderAvailability } from "../../api/providers";
import { useDebouncedSave } from "../../hooks/useDebouncedSave";

interface Stage1IdeaProps {
  draft: Draft;
  onChange: (updated: Draft) => Promise<void>;
  onAdvance: () => Promise<void>;
}

type Provider = "anthropic" | "openai" | "google";

export function Stage1Idea({ draft, onChange, onAdvance }: Stage1IdeaProps): JSX.Element {
  const idea = draft.idea;
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // Local form state mirroring idea fields
  const [topic, setTopic] = useState(idea.topic);
  const [bullets, setBullets] = useState<string[]>(idea.bullets ?? []);
  const [newBullet, setNewBullet] = useState("");
  const [packSlug, setPackSlug] = useState(idea.pack_slug);
  const [format, setFormat] = useState<string>(idea.format ?? "");
  const [provider, setProvider] = useState<Provider>(idea.provider);
  const [model, setModel] = useState(idea.model);
  const [targetWords, setTargetWords] = useState(idea.target_words ?? 1500);
  const [notes, setNotes] = useState(idea.notes ?? "");

  // Build a Draft from current form state
  const buildDraft = useCallback((): Draft => {
    const updatedIdea: IdeaInput = {
      topic,
      bullets,
      pack_slug: packSlug,
      format: format || null,
      provider,
      model,
      target_words: targetWords,
      notes,
    };
    return { ...draft, title: topic || draft.title, idea: updatedIdea };
  }, [draft, topic, bullets, packSlug, format, provider, model, targetWords, notes]);

  // Debounced auto-save
  const draftValue = buildDraft();
  const { saving, error: saveError } = useDebouncedSave(draftValue, onChange, 600);

  useEffect(() => {
    listPacks()
      .then(setPacks)
      .catch(() => {});
    listProviderAvailability()
      .then(setProviders)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!provider || !providers[provider]) {
      setModels([]);
      return;
    }
    listModels(provider)
      .then(setModels)
      .catch(() => setModels([]));
  }, [provider, providers]);

  const addBullet = () => {
    const trimmed = newBullet.trim();
    if (!trimmed) return;
    setBullets((prev) => [...prev, trimmed]);
    setNewBullet("");
  };

  const removeBullet = (idx: number) => {
    setBullets((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAdvance = async () => {
    setAdvancing(true);
    setAdvanceError(null);
    try {
      await onAdvance();
    } catch (e) {
      setAdvanceError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdvancing(false);
    }
  };

  const canAdvance = topic.trim() && packSlug && model && !advancing;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Idea</h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {saving && <span>Saving…</span>}
          {saveError && <span className="text-red-400">{saveError}</span>}
        </div>
      </div>

      <Field label="Topic" id="s1-topic">
        <input
          id="s1-topic"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What is this piece about?"
          className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
        />
      </Field>

      <div>
        <label htmlFor="s1-new-bullet" className="block text-sm font-medium text-slate-200 mb-1">
          Key points
        </label>
        <div className="space-y-1 mb-2">
          {bullets.map((b, i) => (
            <div key={`${b}-${String(i)}`} className="flex items-center gap-2">
              <span className="text-slate-400 text-sm flex-1">{b}</span>
              <button
                type="button"
                onClick={() => removeBullet(i)}
                className="text-slate-500 hover:text-red-400 text-xs"
                aria-label="Remove bullet"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            id="s1-new-bullet"
            type="text"
            value={newBullet}
            onChange={(e) => setNewBullet(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addBullet();
              }
            }}
            placeholder="Add a key point…"
            className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 text-sm"
          />
          <button
            type="button"
            onClick={addBullet}
            className="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
          >
            Add
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Voice pack" id="s1-pack">
          <select
            id="s1-pack"
            value={packSlug}
            onChange={(e) => setPackSlug(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
          >
            <option value="">— pick a pack —</option>
            {packs
              .filter((p) => p.valid)
              .map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.slug}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Format (optional)" id="s1-format">
          <input
            id="s1-format"
            type="text"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            placeholder="e.g. listicle, essay…"
            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Provider" id="s1-provider">
          <select
            id="s1-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
          >
            {(["anthropic", "openai", "google"] as Provider[]).map((p) => (
              <option key={p} value={p} disabled={!providers[p]}>
                {p}
                {!providers[p] && " (no key)"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Model" id="s1-model">
          <select
            id="s1-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
          >
            {models.length === 0 && <option value="">No models</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={`Target length: ${targetWords} words`} id="s1-words">
        <input
          id="s1-words"
          type="range"
          min={500}
          max={3500}
          step={100}
          value={targetWords}
          onChange={(e) => setTargetWords(Number.parseInt(e.target.value, 10))}
          className="w-full"
        />
      </Field>

      <Field label="Notes (optional)" id="s1-notes">
        <textarea
          id="s1-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any extra context for the AI…"
          rows={3}
          className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 text-sm resize-none"
        />
      </Field>

      {advanceError && <p className="text-red-400 text-sm">{advanceError}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleAdvance}
          disabled={!canAdvance}
          className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-50 flex items-center gap-2"
        >
          {advancing ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating outline…
            </>
          ) : (
            "Generate outline →"
          )}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-200 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
