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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-[520px] max-w-[90vw] space-y-4 m-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="New draft"
      >
        <h2 className="text-lg font-semibold">New draft</h2>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Topic" id="nd-topic">
            <input
              id="nd-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
            />
          </Field>
          <Field label="Voice pack" id="nd-pack">
            <select
              id="nd-pack"
              value={pack}
              onChange={(e) => setPack(e.target.value)}
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider" id="nd-provider">
              <select
                id="nd-provider"
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
            <Field label="Model" id="nd-model">
              <select
                id="nd-model"
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
          {modelsError && <p className="text-amber-400 text-xs">{modelsError}</p>}
          <Field label={`Target length: ${targetWords} words`} id="nd-words">
            <input
              id="nd-words"
              type="range"
              min={500}
              max={3500}
              step={100}
              value={targetWords}
              onChange={(e) => setTargetWords(Number.parseInt(e.target.value, 10))}
              className="w-full"
            />
          </Field>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {!providers[provider] && (
            <p className="text-amber-400 text-xs">
              No API key for {provider}. Add one in myvoice (localhost:7878) → Settings.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-slate-700 rounded text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create draft"}
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
      <label htmlFor={id} className="block text-sm font-medium text-slate-200 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
