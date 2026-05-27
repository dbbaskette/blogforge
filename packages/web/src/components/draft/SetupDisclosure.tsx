import { useEffect, useState } from "react";

import type { Draft, IdeaInput } from "../../api/drafts";
import { type PackFormatEntry, type PackSummary, getManifest, listPacks } from "../../api/packs";
import { type ModelInfo, listModels, listProviderAvailability } from "../../api/providers";
import { Icon } from "../ui/Icon";

type Provider = "anthropic" | "openai" | "google";

interface SetupDisclosureProps {
  draft: Draft;
  onChange: (idea: IdeaInput) => void;
  forceOpen?: boolean;
}

export function SetupDisclosure({
  draft,
  onChange,
  forceOpen = false,
}: SetupDisclosureProps): JSX.Element {
  const idea = draft.idea;
  const [open, setOpen] = useState(forceOpen);
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [formats, setFormats] = useState<PackFormatEntry[]>([]);
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    listPacks()
      .then(setPacks)
      .catch(() => {});
    listProviderAvailability()
      .then(setProviders)
      .catch(() => {});
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when pack_slug changes; reading idea.format inside is intentional
  useEffect(() => {
    if (!idea.pack_slug) {
      setFormats([]);
      return;
    }
    let cancelled = false;
    getManifest(idea.pack_slug)
      .then((m) => {
        if (cancelled) return;
        const raw = (m.formats as PackFormatEntry[] | undefined) ?? [];
        setFormats(raw);
        if (idea.format && !raw.some((f) => f.name === idea.format)) {
          onChange({ ...idea, format: null });
        }
      })
      .catch(() => {
        if (!cancelled) setFormats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [idea.pack_slug]);

  useEffect(() => {
    if (!idea.provider || !providers[idea.provider]) {
      setModels([]);
      return;
    }
    listModels(idea.provider)
      .then(setModels)
      .catch(() => setModels([]));
  }, [idea.provider, providers]);

  const summary = `pack ${idea.pack_slug || "—"} · ${idea.format || "no format"} · ${
    idea.provider
  }/${idea.model || "—"} · ${idea.target_words ?? 1500} words`;

  return (
    <section className="nb-card overflow-hidden mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-card-2 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm text-muted">
          <Icon
            name="chevron-right"
            size={14}
            title="toggle"
            className={`transition-transform text-muted-2 ${open ? "rotate-90" : ""}`}
          />
          <span className="font-medium text-ink-2">Setup</span>
          <span className="text-muted">·</span>
          <span className="text-muted">{summary}</span>
        </span>
        <span className="text-cobalt-600 text-xs font-medium">{open ? "Close" : "Edit"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-rule grid grid-cols-2 gap-4 animate-fade-in">
          <FieldSelect
            label="Voice pack"
            id="setup-pack"
            value={idea.pack_slug}
            onChange={(v) => onChange({ ...idea, pack_slug: v })}
            options={[
              { value: "", label: "— pick a pack —" },
              ...packs.filter((p) => p.valid).map((p) => ({ value: p.slug, label: p.slug })),
            ]}
          />
          <FieldSelect
            label="Format"
            id="setup-format"
            value={idea.format ?? ""}
            onChange={(v) => onChange({ ...idea, format: v || null })}
            disabled={formats.length === 0}
            options={[
              { value: "", label: "— none —" },
              ...formats.map((f) => ({
                value: f.name,
                label: f.description ? `${f.name} — ${f.description}` : f.name,
              })),
            ]}
          />
          <FieldSelect
            label="Provider"
            id="setup-provider"
            value={idea.provider}
            onChange={(v) => onChange({ ...idea, provider: v as Provider })}
            options={(["anthropic", "openai", "google"] as Provider[]).map((p) => ({
              value: p,
              label: providers[p] ? p : `${p} (no key)`,
              disabled: !providers[p],
            }))}
          />
          <FieldSelect
            label="Model"
            id="setup-model"
            value={idea.model}
            onChange={(v) => onChange({ ...idea, model: v })}
            options={
              models.length === 0
                ? [{ value: "", label: "No models" }]
                : models.map((m) => ({ value: m.id, label: m.label }))
            }
          />
          <div className="col-span-2">
            <label htmlFor="setup-words" className="nb-label">
              Target length ·{" "}
              <span className="text-ink-2 font-mono normal-case tracking-normal">
                {(idea.target_words ?? 1500).toLocaleString()} words
              </span>
            </label>
            <input
              id="setup-words"
              type="range"
              min={500}
              max={3500}
              step={100}
              value={idea.target_words ?? 1500}
              onChange={(e) =>
                onChange({ ...idea, target_words: Number.parseInt(e.target.value, 10) })
              }
              className="w-full"
            />
          </div>
        </div>
      )}
    </section>
  );
}

interface FieldSelectProps {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
}

function FieldSelect({
  label,
  id,
  value,
  onChange,
  options,
  disabled,
}: FieldSelectProps): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="nb-label">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="nb-select disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
