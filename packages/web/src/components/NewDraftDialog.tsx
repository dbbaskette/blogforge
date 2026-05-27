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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="nb-card w-[560px] max-w-full m-0 p-0 text-ink animate-fade-up"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="New draft"
      >
        <header className="px-7 pt-6 pb-5 border-b border-rule">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-1.5">
            New piece
          </p>
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">
            What's this one about?
          </h2>
          <p className="text-sm text-muted mt-1.5 leading-relaxed">
            Pencraft will draft an outline first, then compose each section in your voice.
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
              className="nb-input"
            />
          </Field>

          <Field label="Voice pack" id="nd-pack">
            <select
              id="nd-pack"
              value={pack}
              onChange={(e) => setPack(e.target.value)}
              className="nb-select"
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
                className="nb-select"
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
                className="nb-select"
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
            <p
              className="text-xs px-3 py-2 rounded-nb-sm"
              style={{ background: "#fdf6e6", color: "#8a5d18", border: "1px solid #f0d5a4" }}
            >
              {modelsError}
            </p>
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
                className="flex-1"
              />
              <span className="font-mono text-sm text-ink tabular-nums min-w-[5.5rem] text-right">
                {targetWords.toLocaleString()}
                <span className="text-muted ml-1">words</span>
              </span>
            </div>
          </Field>

          {error && (
            <p
              className="text-sm px-3 py-2 rounded-nb-sm"
              style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
            >
              {error}
            </p>
          )}
          {!providers[provider] && (
            <p
              className="text-xs px-3 py-2 rounded-nb-sm"
              style={{ background: "#fdf6e6", color: "#8a5d18", border: "1px solid #f0d5a4" }}
            >
              No API key for {provider}. Add one in myvoice → Settings.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="nb-btn">
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className="nb-btn nb-btn-primary">
              {submitting ? "Creating…" : "Create draft →"}
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
      <label htmlFor={id} className="nb-label">
        {label}
      </label>
      {children}
    </div>
  );
}
