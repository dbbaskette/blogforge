import { useCallback, useEffect, useState } from "react";

import { addUrlSource, deleteSource, listSources } from "../../api/voice";
import type { VoiceSource } from "../../api/voice";
import { Icon } from "../ui/Icon";

export function SourcesCard(): JSX.Element {
  const [sources, setSources] = useState<VoiceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSources();
      setSources(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Background sources</h2>
      <div className="nb-card p-6 space-y-4">
        <p className="text-sm text-muted">
          Add reference sites — product docs, terminology pages — the AI can pull facts from when
          writing in this voice. These inform <em>content</em>, not style.
        </p>

        {loading ? (
          <p className="text-sm text-muted italic font-serif">Loading sources…</p>
        ) : error ? (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm"
            style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
          >
            {error}
          </p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-muted italic font-serif">No sources yet. Add one below.</p>
        ) : (
          <ul className="space-y-2">
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} onRefresh={refresh} />
            ))}
          </ul>
        )}

        <hr className="nb-rule" />

        <AddSourceRow onRefresh={refresh} />
      </div>
    </section>
  );
}

interface SourceRowProps {
  source: VoiceSource;
  onRefresh: () => Promise<void>;
}

function SourceRow({ source, onRefresh }: SourceRowProps): JSX.Element {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (): Promise<void> => {
    if (!confirm(`Delete source "${source.name || source.url}"?`)) return;
    setDeleting(true);
    try {
      await deleteSource(source.id);
      await onRefresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li className="flex items-center gap-3 py-2 px-3 rounded-nb-sm hover:bg-card-2 transition-colors">
      <div className="flex-1 min-w-0">
        <span className="text-sm text-ink font-medium truncate block">
          {source.name || source.url}
        </span>
        <span className="text-xs text-muted truncate block">
          {source.extracted_chars.toLocaleString()} chars
          {source.status === "failed" && (
            <span className="ml-2" style={{ color: "#b5321b" }}>
              · couldn't fetch
            </span>
          )}
        </span>
      </div>
      {source.status === "failed" && (
        <span className="nb-pill" style={{ background: "#fde7e2", color: "#b5321b" }}>
          failed
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={deleting}
        aria-label={`Delete source ${source.name || source.url}`}
        className="nb-icon-btn shrink-0 text-muted hover:text-rose"
      >
        <Icon name="trash" size={14} title="" />
      </button>
    </li>
  );
}

interface AddSourceRowProps {
  onRefresh: () => Promise<void>;
}

function AddSourceRow({ onRefresh }: AddSourceRowProps): JSX.Element {
  const [urlValue, setUrlValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (): Promise<void> => {
    const url = urlValue.trim();
    if (!url) return;
    setAdding(true);
    setError(null);
    try {
      await addUrlSource(url);
      await onRefresh();
      setUrlValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">Add source</p>
      <div className="flex gap-2">
        <input
          type="url"
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder="https://…"
          className="nb-input flex-1"
          aria-label="Source URL"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding || !urlValue.trim()}
          className="nb-btn nb-btn-primary nb-btn-sm shrink-0"
        >
          {adding ? "Fetching…" : "Add source"}
        </button>
      </div>
      {error && (
        <p
          className="text-sm px-3 py-2 rounded-nb-sm"
          style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
