import { useState } from "react";

import { setKey } from "../../api/keys";

const KEY_PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
];

/**
 * Compact "add a key without leaving compose" form. Shown when no writing model
 * is available at all — turns the old dead-end (a red banner pointing to
 * Settings) into a two-field fix right where the writer already is. On success
 * the parent refetches provider availability so the run buttons unlock.
 */
export function InlineKeySetup({ onSaved }: { onSaved: () => void }): JSX.Element {
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await setKey(provider, apiKey.trim());
      setApiKey("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="px-4 py-3 rounded-nb-sm space-y-2"
      style={{ background: "#fbf1de", border: "1px solid #f3d89b" }}
    >
      <p className="text-sm" style={{ color: "#92600a" }}>
        No writing model is ready yet. Add a provider key to start — it stays on your account.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="sr-only" htmlFor="inline-key-provider">
          Provider
        </label>
        <select
          id="inline-key-provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="nb-select w-auto"
        >
          {KEY_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="inline-key-value">
          API key
        </label>
        <input
          id="inline-key-value"
          type="password"
          autoComplete="off"
          className="nb-input flex-1 min-w-[12rem]"
          placeholder="Paste API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        <button
          type="button"
          className="nb-btn nb-btn-primary"
          onClick={save}
          disabled={busy || !apiKey.trim()}
        >
          {busy ? "Saving…" : "Save key"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
