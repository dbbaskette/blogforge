import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { type IdeaInput, createDraft } from "../api/drafts";
import { type PackSummary, listPacks } from "../api/packs";
import { type ModelInfo, listModels, listProviderAvailability } from "../api/providers";
import { type Template, deleteTemplate, listTemplates } from "../api/templates";
import { Icon } from "./ui/Icon";

interface NewDraftDialogProps {
  open: boolean;
  onClose: () => void;
}

type Provider = "anthropic" | "openai" | "google" | "claude-cli";

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
  const [useVoiceProfile, setUseVoiceProfile] = useState(true);
  // Carried from an applied template; folded into the idea on submit.
  const [extras, setExtras] = useState<{ bullets: string[]; notes: string; format: string | null }>(
    { bullets: [], notes: "", format: null },
  );
  const [templates, setTemplates] = useState<Template[]>([]);
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
    listTemplates()
      .then(setTemplates)
      .catch(() => {});
  }, [open]);

  const applyTemplate = (t: Template): void => {
    setTopic(t.topic);
    setPack(t.pack_slug);
    setProvider(t.provider);
    setModel(t.model);
    setTargetWords(t.target_words);
    setExtras({ bullets: t.bullets, notes: t.notes, format: t.format });
  };

  const removeTemplate = async (id: string): Promise<void> => {
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch {
      /* non-fatal */
    }
  };

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
            `${provider} rejected the configured key. An admin can replace it under /admin (API keys section).`,
          );
        } else {
          setModelsError(`Failed to load ${provider} models: ${msg}`);
        }
      });
  }, [provider, providers]);

  useEffect(() => {
    // Pick the first model when none is set OR when the current one isn't valid
    // for the selected provider (e.g. switching to claude-cli while a Google
    // model is still selected — claude -p would reject it).
    if (models.length > 0 && !models.some((m) => m.id === model)) {
      setModel(models[0].id);
    }
  }, [models, model]);

  if (!open) return null;

  // In profile mode we still need a valid pack_slug for backend validation.
  // Keep the picker rendered so there's always a value; just hide it visually
  // when profile mode is active by relabelling the section.
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
        bullets: extras.bullets,
        notes: extras.notes,
        format: extras.format,
        use_voice_profile: useVoiceProfile,
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
            BlogForge will draft an outline first, then compose each section in your voice.
          </p>
        </header>

        <form onSubmit={submit} className="px-7 pt-5 pb-6 space-y-5">
          {templates.length > 0 && (
            <div>
              <span className="nb-label">Start from a template</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {templates.map((t) => (
                  <span
                    key={t.id}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-rule bg-card pl-3 pr-1.5 py-1 text-sm hover:border-cobalt-300 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="text-ink-2 hover:text-cobalt-700 font-medium"
                    >
                      {t.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTemplate(t.id)}
                      className="nb-icon-btn !w-5 !h-5 opacity-40 group-hover:opacity-100"
                      aria-label={`Delete template ${t.name}`}
                    >
                      <Icon name="x" size={12} title="" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

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

          <div>
            <span className="nb-label">Voice source</span>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => setUseVoiceProfile(true)}
                className={`flex-1 px-3 py-2 text-sm rounded-nb-sm border transition-colors ${
                  useVoiceProfile
                    ? "border-cobalt-400 bg-cobalt-50 text-cobalt-800 font-medium"
                    : "border-rule bg-card text-ink-2 hover:border-cobalt-300"
                }`}
                aria-pressed={useVoiceProfile}
              >
                My voice profile
              </button>
              <button
                type="button"
                onClick={() => setUseVoiceProfile(false)}
                className={`flex-1 px-3 py-2 text-sm rounded-nb-sm border transition-colors ${
                  !useVoiceProfile
                    ? "border-cobalt-400 bg-cobalt-50 text-cobalt-800 font-medium"
                    : "border-rule bg-card text-ink-2 hover:border-cobalt-300"
                }`}
                aria-pressed={!useVoiceProfile}
              >
                A voice pack
              </button>
            </div>
          </div>

          {useVoiceProfile ? (
            <div>
              <p className="text-xs text-muted px-3 py-2 rounded-nb-sm bg-cobalt-50/60 border-l-[3px] border-cobalt-200">
                Generating in your saved voice profile.
              </p>
              {/* Keep pack picker rendered (hidden) so pack state stays populated for backend validation */}
              <div className="hidden">
                <select
                  aria-hidden
                  tabIndex={-1}
                  value={pack}
                  onChange={(e) => setPack(e.target.value)}
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
              </div>
              {/* Auto-select first valid pack when in profile mode so pack_slug is always set */}
              {!pack && packs.filter((p) => p.valid).length > 0 && (
                <AutoSelectPack packs={packs} onSelect={setPack} />
              )}
            </div>
          ) : (
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
              <PackPreview pack={packs.find((p) => p.slug === pack)} />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider" id="nd-provider">
              <select
                id="nd-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
                className="nb-select"
              >
                {(["anthropic", "openai", "google", "claude-cli"] as Provider[]).map((p) => (
                  <option key={p} value={p} disabled={!providers[p]}>
                    {p === "claude-cli" ? "claude (CLI · subscription)" : p}
                    {!providers[p] && (p === "claude-cli" ? " (not installed)" : " (no key)")}
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
                    {formatRateSuffix(m)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <ModelCostHint model={models.find((m) => m.id === model)} targetWords={targetWords} />

          {modelsError && (
            <p
              className="text-xs px-3 py-2 rounded-nb-sm"
              style={{ background: "#fbf1de", color: "#92600a", border: "1px solid #f3d89b" }}
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
              style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
            >
              {error}
            </p>
          )}
          {!providers[provider] && (
            <p
              className="text-xs px-3 py-2 rounded-nb-sm"
              style={{ background: "#fbf1de", color: "#92600a", border: "1px solid #f3d89b" }}
            >
              No API key for {provider}. An admin can add one under /admin (API keys section).
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

/** Silently selects the first valid pack; used in profile mode so pack_slug is always set. */
function AutoSelectPack({
  packs,
  onSelect,
}: {
  packs: PackSummary[];
  onSelect: (slug: string) => void;
}): null {
  useEffect(() => {
    const first = packs.find((p) => p.valid);
    if (first) onSelect(first.slug);
  }, [packs, onSelect]);
  return null;
}

function PackPreview({ pack }: { pack: PackSummary | undefined }): JSX.Element | null {
  if (!pack) return null;
  const description = pack.description?.trim();
  const oneLine = pack.one_line?.trim();
  if (!description && !oneLine) return null;
  return (
    <div className="mt-2 px-3 py-2 rounded-nb-sm bg-cobalt-50/60 border-l-[3px] border-cobalt-200 animate-fade-in">
      {description && <p className="text-xs text-ink-2 leading-snug">{description}</p>}
      {oneLine && (
        <p className="text-xs font-serif italic text-cobalt-700 leading-snug mt-0.5">{oneLine}</p>
      )}
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

// Words → output tokens. English averages ~1.3-1.5 tokens/word; use 1.5 conservatively.
const WORDS_TO_OUT_TOKENS = 1.5;
// Typical pack-driven prompt overhead. Crude but consistent across models for comparison.
const ASSUMED_INPUT_TOKENS = 2000;

function formatRateSuffix(m: ModelInfo): string {
  if (m.input_per_million_usd == null || m.output_per_million_usd == null) return "";
  const fmt = (n: number): string =>
    n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`;
  return ` — ${fmt(m.input_per_million_usd)} in / ${fmt(m.output_per_million_usd)} out per 1M`;
}

function ModelCostHint({
  model,
  targetWords,
}: {
  model: ModelInfo | undefined;
  targetWords: number;
}): JSX.Element | null {
  if (!model || model.input_per_million_usd == null || model.output_per_million_usd == null) {
    return null;
  }
  const outTokens = Math.round(targetWords * WORDS_TO_OUT_TOKENS);
  const inCost = (ASSUMED_INPUT_TOKENS / 1_000_000) * model.input_per_million_usd;
  const outCost = (outTokens / 1_000_000) * model.output_per_million_usd;
  const total = inCost + outCost;
  const fmt = (n: number): string => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
  return (
    <p className="text-xs text-muted leading-snug -mt-1">
      Est. cost for ~{targetWords} words: <strong className="text-ink">{fmt(total)}</strong>
      <span className="text-muted/80">
        {" "}
        ({fmt(inCost)} prompt + {fmt(outCost)} output · ~{ASSUMED_INPUT_TOKENS} in / {outTokens} out
        tokens)
      </span>
    </p>
  );
}
