import { useCallback, useEffect, useState } from "react";

import { deleteKey, getKeyStatus, type KeyStatus, setKey } from "../../api/keys";

const PROVIDERS: Array<{ id: string; label: string }> = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
];

export function ProviderKeysCard(): JSX.Element {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getKeyStatus()
      .then(setStatus)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Provider API keys</h2>
      <div className="nb-card p-6 space-y-4">
        {loadError && (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm"
            style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
          >
            {loadError}
          </p>
        )}
        {status === null && !loadError && (
          <p className="text-center text-muted text-sm py-4">Loading…</p>
        )}
        {status !== null && (
          <ul className="space-y-4">
            {PROVIDERS.map((p, i) => (
              <ProviderRow
                key={p.id}
                id={p.id}
                label={p.label}
                isSet={status[p.id] ?? false}
                onChanged={reload}
                showGoogleNote={i === PROVIDERS.length - 1}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface ProviderRowProps {
  id: string;
  label: string;
  isSet: boolean;
  onChanged: () => void;
  showGoogleNote: boolean;
}

function ProviderRow({ id, label, isSet, onChanged, showGoogleNote }: ProviderRowProps): JSX.Element {
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const onSave = async (): Promise<void> => {
    if (!inputValue.trim()) return;
    setSaving(true);
    setRowError(null);
    try {
      await setKey(id, inputValue.trim());
      setInputValue("");
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onClear = async (): Promise<void> => {
    setSaving(true);
    setRowError(null);
    try {
      await deleteKey(id);
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-ink w-36 shrink-0">{label}</span>
          <span className="text-sm text-muted">
            {isSet ? (
              <span className="text-green-700 font-medium">Set ✓</span>
            ) : (
              <span className="text-muted">Not set</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`Paste ${label} key`}
            className="nb-input font-mono text-sm w-64"
            aria-label={`${label} API key`}
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !inputValue.trim()}
            className="nb-btn nb-btn-primary nb-btn-sm"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {isSet && (
            <button
              type="button"
              onClick={onClear}
              disabled={saving}
              className="nb-btn nb-btn-sm"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {rowError && (
        <p
          className="text-xs px-3 py-2 rounded-nb-sm"
          style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
        >
          {rowError}
        </p>
      )}
      {showGoogleNote && (
        <p className="text-xs text-muted">Required for hero images.</p>
      )}
    </li>
  );
}
