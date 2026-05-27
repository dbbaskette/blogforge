import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  type Provider,
  type ProviderKeyStatus,
  deleteProviderKey,
  listProviderKeys,
  setProviderKey,
} from "../api/adminKeys";

const PROVIDERS: Provider[] = ["anthropic", "google", "openai"];

const LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
};

export function ProviderKeysSection(): JSX.Element {
  const [keys, setKeys] = useState<ProviderKeyStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listProviderKeys()
      .then(setKeys)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  if (keys === null && !error) {
    return <p className="text-center text-muted text-sm py-8">Loading keys…</p>;
  }

  const byProvider: Partial<Record<Provider, ProviderKeyStatus>> = Object.fromEntries(
    (keys ?? []).map((k) => [k.provider, k]),
  );

  return (
    <section>
      <h2 className="font-serif text-xl font-medium text-ink mb-3">API keys</h2>
      <p className="text-sm text-muted mb-4">
        Keys are encrypted at rest and never displayed after saving. PUT validates the key by
        calling the provider's list-models endpoint, so a typo here won't quietly break drafting.
      </p>

      {error && (
        <div
          className="mb-4 p-3 rounded-nb-sm text-sm"
          style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
        >
          {error}
        </div>
      )}

      <ul className="space-y-3">
        {PROVIDERS.map((p) => (
          <ProviderRow
            key={p}
            provider={p}
            status={byProvider[p]}
            onChanged={reload}
            onError={setError}
          />
        ))}
      </ul>
    </section>
  );
}

interface ProviderRowProps {
  provider: Provider;
  status: ProviderKeyStatus | undefined;
  onChanged: () => void;
  onError: (msg: string) => void;
}

function ProviderRow({ provider, status, onChanged, onError }: ProviderRowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const configured = status?.configured ?? false;
  const source = status?.source ?? "none";
  const updatedAt = status?.updated_at ? new Date(status.updated_at) : null;

  const onSave = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!value.trim()) return;
    setSubmitting(true);
    try {
      await setProviderKey(provider, value.trim());
      setValue("");
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onRemove = async (): Promise<void> => {
    if (!window.confirm(`Remove the ${LABELS[provider]} key?`)) return;
    setSubmitting(true);
    try {
      await deleteProviderKey(provider);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <li className="nb-card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium text-ink">{LABELS[provider]}</div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`nb-pill ${configured ? "nb-pill-ready" : "nb-pill-empty"}`}
              aria-label={configured ? "configured" : "not set"}
            >
              <span className="dot" />
              {configured ? "configured" : "not set"}
            </span>
            {source === "myvoice" && (
              <span className="text-xs text-muted">
                (using myvoice fallback — save here to take over)
              </span>
            )}
            {updatedAt && (
              <span className="text-xs text-muted">updated {updatedAt.toLocaleString()}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="nb-btn nb-btn-sm"
              disabled={submitting}
            >
              {configured && source === "stored" ? "Replace" : "Add"}
            </button>
          )}
          {configured && source === "stored" && !editing && (
            <button
              type="button"
              onClick={onRemove}
              className="nb-btn nb-btn-sm"
              disabled={submitting}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {editing && (
        <form onSubmit={onSave} className="mt-3 flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Paste your ${LABELS[provider]} API key`}
            className="nb-input flex-1 font-mono text-sm"
            aria-label={`${LABELS[provider]} API key`}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="nb-btn nb-btn-primary nb-btn-sm"
              disabled={submitting || !value.trim()}
            >
              {submitting ? "Validating…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setValue("");
                setEditing(false);
              }}
              className="nb-btn nb-btn-sm"
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
