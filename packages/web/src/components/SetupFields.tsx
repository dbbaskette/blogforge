import { useEffect, useRef, useState } from "react";

import { type PackFormatEntry, type PackSummary, getManifest, listPacks } from "../api/packs";
import { type ModelInfo, listModels, listProviderAvailability } from "../api/providers";
import type { ComposeSettings } from "../lib/composeDefaults";

export type { ComposeSettings };

interface SetupFieldsProps {
  value: ComposeSettings;
  onChange: (next: ComposeSettings) => void;
}

type Provider = "anthropic" | "openai" | "google" | "claude-cli" | "tanzu";

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "claude-cli": "Claude CLI",
  tanzu: "Tanzu",
};

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

export function SetupFields({ value, onChange }: SetupFieldsProps): JSX.Element {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [formats, setFormats] = useState<PackFormatEntry[]>([]);

  const valueRef = useRef(value);
  valueRef.current = value;

  // Load packs and providers on mount
  useEffect(() => {
    listPacks()
      .then(setPacks)
      .catch(() => {});
    listProviderAvailability()
      .then(setProviders)
      .catch(() => {});
  }, []);

  // Load formats when pack_slug changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when pack_slug changes; reading value.format inside is intentional
  useEffect(() => {
    if (!value.pack_slug) {
      setFormats([]);
      return;
    }
    let cancelled = false;
    getManifest(value.pack_slug)
      .then((m) => {
        if (cancelled) return;
        const raw = (m.formats as PackFormatEntry[] | undefined) ?? [];
        setFormats(raw);
        if (value.format && !raw.some((f) => f.name === value.format)) {
          onChange({ ...valueRef.current, format: null });
        }
      })
      .catch(() => {
        if (!cancelled) setFormats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [value.pack_slug]);

  // Load models when provider changes
  useEffect(() => {
    setModelsError(null);
    if (!value.provider || !providers[value.provider]) {
      setModels([]);
      return;
    }
    listModels(value.provider)
      .then((m) => {
        setModels(m);
        setModelsError(null);
      })
      .catch((e: Error) => {
        setModels([]);
        const msg = e.message ?? String(e);
        if (msg.includes("provider_missing_key") || msg.includes("HTTP 400")) {
          setModelsError(
            `${value.provider} rejected the configured key. Add your key in Settings → Provider API keys.`,
          );
        } else {
          setModelsError(`Failed to load ${value.provider} models: ${msg}`);
        }
      });
  }, [value.provider, providers]);

  // Auto-pick first model when current model is invalid for the selected provider.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads valueRef.current + stable onChange; only re-run when the model list / selected model changes
  useEffect(() => {
    if (models.length > 0 && !models.some((m) => m.id === value.model)) {
      onChange({ ...valueRef.current, model: models[0].id });
    }
  }, [models, value.model]);

  return (
    <div className="space-y-5">
      {/* Voice source toggle */}
      <div>
        <span className="nb-label">Voice source</span>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => onChange({ ...value, use_voice_profile: true, format: null })}
            className={`flex-1 px-3 py-2 text-sm rounded-nb-sm border transition-colors ${
              value.use_voice_profile
                ? "border-cobalt-400 bg-cobalt-50 text-cobalt-800 font-medium"
                : "border-rule bg-card text-ink-2 hover:border-cobalt-300"
            }`}
            aria-pressed={value.use_voice_profile}
          >
            My voice profile
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...value, use_voice_profile: false })}
            className={`flex-1 px-3 py-2 text-sm rounded-nb-sm border transition-colors ${
              !value.use_voice_profile
                ? "border-cobalt-400 bg-cobalt-50 text-cobalt-800 font-medium"
                : "border-rule bg-card text-ink-2 hover:border-cobalt-300"
            }`}
            aria-pressed={!value.use_voice_profile}
          >
            A voice pack
          </button>
        </div>
      </div>

      {/* Pack block */}
      {value.use_voice_profile ? (
        <div>
          <p className="text-xs text-muted px-3 py-2 rounded-nb-sm bg-cobalt-50/60 border-l-[3px] border-cobalt-200">
            Generating in your saved voice profile.
          </p>
          {/* Keep pack picker rendered (hidden) so pack_slug state stays populated for backend validation */}
          <div className="hidden">
            <select
              aria-hidden
              tabIndex={-1}
              value={value.pack_slug}
              onChange={(e) => onChange({ ...value, pack_slug: e.target.value })}
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
          {!value.pack_slug && packs.filter((p) => p.valid).length > 0 && (
            <AutoSelectPack
              packs={packs}
              onSelect={(slug) => onChange({ ...value, pack_slug: slug })}
            />
          )}
        </div>
      ) : (
        <Field label="Voice pack" id="sf-pack">
          <select
            id="sf-pack"
            value={value.pack_slug}
            onChange={(e) => onChange({ ...value, pack_slug: e.target.value })}
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
          <PackPreview pack={packs.find((p) => p.slug === value.pack_slug)} />
        </Field>
      )}

      {/* Format select — only for voice packs; profiles carry no named formats. */}
      <Field label="Format" id="sf-format">
        <select
          id="sf-format"
          value={value.use_voice_profile ? "" : (value.format ?? "")}
          onChange={(e) => onChange({ ...value, format: e.target.value || null })}
          disabled={value.use_voice_profile || formats.length === 0}
          className="nb-select disabled:opacity-60"
        >
          <option value="">— none —</option>
          {formats.map((f) => (
            <option key={f.name} value={f.name}>
              {f.description ? `${f.name} — ${f.description}` : f.name}
            </option>
          ))}
        </select>
        {value.use_voice_profile && (
          <p className="text-xs text-muted mt-1">
            Named formats apply to voice packs — your profile writes in its distilled voice.
          </p>
        )}
      </Field>

      {/* Provider / Model grid */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Provider" id="sf-provider">
          <select
            id="sf-provider"
            value={value.provider}
            onChange={(e) => onChange({ ...value, provider: e.target.value as Provider })}
            className="nb-select"
          >
            {(["anthropic", "openai", "google", "claude-cli", "tanzu"] as Provider[]).map((p) => (
              <option key={p} value={p} disabled={!providers[p]}>
                {p === "claude-cli"
                  ? "Claude CLI (subscription)"
                  : (PROVIDER_LABELS[p] ?? p)}
                {!providers[p] && (p === "claude-cli" ? " (not installed)" : " (no key/service)")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Model" id="sf-model">
          <select
            id="sf-model"
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
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

      <ModelCostHint model={models.find((m) => m.id === value.model)} targetWords={value.target_words} />

      {modelsError && (
        <p
          className="text-xs px-3 py-2 rounded-nb-sm"
          style={{ background: "#fbf1de", color: "#92600a", border: "1px solid #f3d89b" }}
        >
          {modelsError}
        </p>
      )}

      {!providers[value.provider] && (
        <p
          className="text-xs px-3 py-2 rounded-nb-sm"
          style={{ background: "#fbf1de", color: "#92600a", border: "1px solid #f3d89b" }}
        >
          No API key for {value.provider}. Add your key in Settings → Provider API keys.
        </p>
      )}

      {/* Target length slider */}
      <Field label="Target length" id="sf-words">
        <div className="flex items-center gap-4">
          <input
            id="sf-words"
            type="range"
            min={500}
            max={3500}
            step={100}
            value={value.target_words}
            onChange={(e) => onChange({ ...value, target_words: Number.parseInt(e.target.value, 10) })}
            className="flex-1"
            aria-label="Target length"
          />
          <span className="font-mono text-sm text-ink tabular-nums min-w-[5.5rem] text-right">
            {value.target_words.toLocaleString()}
            <span className="text-muted ml-1">words</span>
          </span>
        </div>
      </Field>
    </div>
  );
}
