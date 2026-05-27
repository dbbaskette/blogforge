import { useCallback, useEffect, useState } from "react";

import type { Draft, IdeaInput } from "../../api/drafts";
import { type PackFormatEntry, type PackSummary, getManifest, listPacks } from "../../api/packs";
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
  const [packFormats, setPackFormats] = useState<PackFormatEntry[]>([]);
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

  // Debounced auto-save. Suspended while advancing so a stale state can't
  // race the Generate-outline POST and clobber the server's new outline.
  const draftValue = buildDraft();
  const saveWhenNotAdvancing = useCallback(
    async (v: Draft) => {
      if (advancing) return;
      await onChange(v);
    },
    [advancing, onChange],
  );
  const { saving, error: saveError } = useDebouncedSave(draftValue, saveWhenNotAdvancing, 600);

  useEffect(() => {
    listPacks()
      .then(setPacks)
      .catch(() => {});
    listProviderAvailability()
      .then(setProviders)
      .catch(() => {});
  }, []);

  // Load formats from the selected pack's manifest. Clears the format selection
  // if the previously-stored format isn't valid in the new pack.
  // biome-ignore lint/correctness/useExhaustiveDependencies: format is read once on pack change
  useEffect(() => {
    if (!packSlug) {
      setPackFormats([]);
      return;
    }
    let cancelled = false;
    getManifest(packSlug)
      .then((m) => {
        if (cancelled) return;
        const raw = (m.formats as PackFormatEntry[] | undefined) ?? [];
        setPackFormats(raw);
        if (format && !raw.some((f) => f.name === format)) setFormat("");
      })
      .catch(() => {
        if (!cancelled) setPackFormats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [packSlug]);

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
    <div className="space-y-6 animate-fade-up">
      <StageHeader
        eyebrow="Stage 01 · The seed"
        title="What's the piece about?"
        subline="Plant a topic. Pick a voice. Pencraft drafts an outline first."
        saving={saving}
        saveError={saveError}
      />

      <Field label="Topic" id="s1-topic">
        <input
          id="s1-topic"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Building agents that don't suck"
          className="w-full bg-ink border border-rule rounded-sm px-3 py-2.5 text-cream-2 font-prose text-base placeholder:text-muted-2 focus:border-vermilion-400 focus:outline-none transition-colors"
        />
      </Field>

      <div>
        <label
          htmlFor="s1-new-bullet"
          className="block font-mono text-[10px] uppercase tracking-wide-3 text-muted mb-1.5"
        >
          Key points
        </label>
        {bullets.length > 0 && (
          <ol className="mb-2 border-l border-rule pl-4 space-y-1.5">
            {bullets.map((b, i) => (
              <li key={`${b}-${String(i)}`} className="flex items-baseline gap-3 group/bullet">
                <span className="font-mono-num text-[10px] text-muted-2 w-6 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-prose text-sm text-cream/85 flex-1 leading-snug">{b}</span>
                <button
                  type="button"
                  onClick={() => removeBullet(i)}
                  className="opacity-0 group-hover/bullet:opacity-100 focus:opacity-100 transition-opacity font-mono text-[10px] uppercase tracking-wide-3 text-muted hover:text-vermilion-400"
                  aria-label="Remove bullet"
                >
                  remove
                </button>
              </li>
            ))}
          </ol>
        )}
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
            placeholder="A thread to pull on…"
            className="flex-1 bg-ink border border-rule rounded-sm px-3 py-2 text-cream font-prose text-sm placeholder:text-muted-2 focus:border-vermilion-400 focus:outline-none transition-colors"
          />
          <button type="button" onClick={addBullet} className="btn-press">
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
            className="w-full bg-ink border border-rule rounded-sm px-3 py-2.5 text-cream font-ui text-sm focus:border-vermilion-400 focus:outline-none transition-colors"
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
          <select
            id="s1-format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="w-full bg-ink border border-rule rounded-sm px-3 py-2.5 text-cream font-ui text-sm focus:border-vermilion-400 focus:outline-none transition-colors disabled:opacity-50"
            disabled={packFormats.length === 0}
          >
            <option value="">— none —</option>
            {packFormats.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
                {f.description ? ` — ${f.description}` : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Provider" id="s1-provider">
          <select
            id="s1-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="w-full bg-ink border border-rule rounded-sm px-3 py-2.5 text-cream font-ui text-sm focus:border-vermilion-400 focus:outline-none transition-colors"
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
            className="w-full bg-ink border border-rule rounded-sm px-3 py-2.5 text-cream font-ui text-sm focus:border-vermilion-400 focus:outline-none transition-colors"
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

      <Field label="Target length" id="s1-words">
        <div className="flex items-center gap-4">
          <input
            id="s1-words"
            type="range"
            min={500}
            max={3500}
            step={100}
            value={targetWords}
            onChange={(e) => setTargetWords(Number.parseInt(e.target.value, 10))}
            className="flex-1 accent-vermilion"
          />
          <span className="font-mono-num text-sm text-cream-2 tabular-nums min-w-[5rem] text-right">
            {targetWords.toLocaleString()} <span className="text-muted">words</span>
          </span>
        </div>
      </Field>

      <Field label="Notes (optional)" id="s1-notes">
        <textarea
          id="s1-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any extra context for the writer — angle, tone, audience…"
          rows={3}
          className="w-full bg-ink border border-rule rounded-sm px-3 py-2.5 text-cream font-prose text-sm placeholder:text-muted-2 focus:border-vermilion-400 focus:outline-none transition-colors resize-none"
        />
      </Field>

      {advanceError && (
        <p className="text-vermilion-300 text-sm border-l-2 border-vermilion pl-3">
          {advanceError}
        </p>
      )}

      <div className="flex justify-end pt-2 border-t border-rule">
        <button
          type="button"
          onClick={handleAdvance}
          disabled={!canAdvance}
          className="btn-stamp mt-4"
        >
          {advancing ? (
            <>
              <Spinner /> Generating outline…
            </>
          ) : (
            <>Generate outline →</>
          )}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Shared stage header used by Stage 1/2/3 — masthead style

export function StageHeader({
  eyebrow,
  title,
  subline,
  saving,
  saveError,
}: {
  eyebrow: string;
  title: string;
  subline?: string;
  saving?: boolean;
  saveError?: string | null;
}): JSX.Element {
  return (
    <header className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400">
          {eyebrow}
        </p>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wide-3">
          {saving && <span className="text-muted">saving…</span>}
          {saveError && <span className="text-vermilion-300">{saveError}</span>}
        </div>
      </div>
      <h2 className="font-display text-cream-2 text-[clamp(2rem,4vw,3rem)] leading-[1] tracking-tight-2">
        {title}
      </h2>
      {subline && (
        <p className="font-prose text-cream/65 text-base leading-relaxed max-w-2xl">{subline}</p>
      )}
      <div className="rule" />
    </header>
  );
}

export function Field({
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
      <label
        htmlFor={id}
        className="block font-mono text-[10px] uppercase tracking-wide-3 text-muted mb-1.5"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function Spinner(): JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
    />
  );
}
