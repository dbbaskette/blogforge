import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { type IdeaInput, createDraft } from "../api/drafts";
import { type PackSummary, listPacks } from "../api/packs";
import { type ModelInfo, listModels, listProviderAvailability } from "../api/providers";

interface NewDraftDialogProps {
  open: boolean;
  onClose: () => void;
}

type Provider = "anthropic" | "openai" | "google";

export function NewDraftDialog({ open, onClose }: NewDraftDialogProps): JSX.Element | null {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [topic, setTopic] = useState("");
  const [pack, setPack] = useState("");
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState("");
  const [targetWords, setTargetWords] = useState(1500);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listPacks()
      .then(setPacks)
      .catch(() => {});
    listProviderAvailability()
      .then(setProviders)
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    setModelsError(null);
    if (!provider || !providers[provider]) {
      setModels([]);
      return;
    }
    listModels(provider)
      .then((m) => {
        setModels(m);
        setModelsError(null);
      })
      .catch((e: Error) => {
        setModels([]);
        const msg = e.message ?? String(e);
        if (msg.includes("provider_missing_key") || msg.includes("HTTP 400")) {
          setModelsError(
            `${provider} rejected the configured key. Update it in myvoice (localhost:7878 → Settings).`,
          );
        } else {
          setModelsError(`Failed to load ${provider} models: ${msg}`);
        }
      });
  }, [provider, providers]);

  useEffect(() => {
    if (!model && models.length > 0) setModel(models[0].id);
  }, [models, model]);

  if (!open) return null;

  const canSubmit = topic.trim() && pack && model && providers[provider] && !submitting;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const idea: IdeaInput = {
        topic,
        pack_slug: pack,
        provider,
        model,
        target_words: targetWords,
      };
      const draft = await createDraft(idea);
      onClose();
      navigate(`/drafts/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="bg-surface border border-rule rounded-sm w-[560px] max-w-[92vw] m-0 p-0 text-cream shadow-2xl shadow-vermilion-900/30"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="New draft"
      >
        {/* Header — masthead style */}
        <header className="px-7 pt-6 pb-5 border-b border-rule">
          <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400 mb-2">
            New piece
          </p>
          <h2 className="font-display text-cream-2 text-2xl tracking-tight-2">Plant a seed.</h2>
          <p className="font-prose text-cream/60 text-sm mt-2">
            What's the piece about? Pick a voice. Pencraft drafts an outline first.
          </p>
        </header>

        <form onSubmit={submit} className="px-7 pt-5 pb-6 space-y-5">
          <Field label="Topic" id="nd-topic">
            <input
              id="nd-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Building agents that don't suck"
              className="w-full bg-ink border border-rule rounded-sm px-3 py-2.5 text-cream-2 font-prose text-base placeholder:text-muted-2 focus:border-vermilion-400 focus:outline-none transition-colors"
            />
          </Field>

          <Field label="Voice pack" id="nd-pack">
            <select
              id="nd-pack"
              value={pack}
              onChange={(e) => setPack(e.target.value)}
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider" id="nd-provider">
              <select
                id="nd-provider"
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
            <Field label="Model" id="nd-model">
              <select
                id="nd-model"
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
          {modelsError && (
            <p className="text-gold text-xs border-l-2 border-gold pl-3">{modelsError}</p>
          )}

          <Field label="Target length" id="nd-words">
            <div className="flex items-center gap-4">
              <input
                id="nd-words"
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

          {error && (
            <p className="text-vermilion-300 text-sm border-l-2 border-vermilion pl-3">{error}</p>
          )}
          {!providers[provider] && (
            <p className="text-gold text-xs border-l-2 border-gold pl-3">
              No API key for {provider}. Add one in myvoice → Settings.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-press">
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className="btn-stamp">
              {submitting ? "Setting type…" : "Begin →"}
            </button>
          </div>
        </form>
      </dialog>
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
