import { useEffect, useState } from "react";

import {
  type Provider,
  getDefaultProvider,
  listProviderAvailability,
  setDefaultProvider,
} from "../../api/providers";

const LABELS: Record<Provider, string> = {
  "codex-cli": "Codex CLI (subscription)",
  "claude-cli": "Claude CLI (subscription)",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
  google: "Google API",
  tanzu: "Tanzu bound model",
};

const PROVIDERS = Object.keys(LABELS) as Provider[];

export function DefaultProviderCard(): JSX.Element {
  const [selected, setSelected] = useState<Provider | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getDefaultProvider(), listProviderAvailability()])
      .then(([preference, available]) => {
        setSelected(preference.default_provider);
        setAvailability(available);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setLoading(false));
  }, []);

  const choose = async (provider: Provider): Promise<void> => {
    const previous = selected;
    setSelected(provider);
    setSaving(true);
    setError(null);
    try {
      await setDefaultProvider(provider);
    } catch (reason) {
      setSelected(previous);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Default writing provider</h2>
      <div className="nb-card p-6 space-y-3">
        <p className="text-sm text-muted leading-snug">
          Choose the provider used by default for new drafts.
        </p>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <div className="space-y-2">
            {PROVIDERS.map((provider) => {
              const available = availability[provider] === true;
              return (
                <label
                  key={provider}
                  className={`flex items-center gap-2 text-sm ${available ? "text-ink-2 cursor-pointer" : "text-muted"}`}
                >
                  <input
                    type="radio"
                    name="default-provider"
                    value={provider}
                    checked={selected === provider}
                    disabled={!available || saving}
                    onChange={() => void choose(provider)}
                  />
                  <span>
                    {LABELS[provider]}
                    {!available && " — unavailable"}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {error && <p className="text-sm text-rose">{error}</p>}
      </div>
    </section>
  );
}
