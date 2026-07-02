import { useState } from "react";

/** Optional multi-URL input for compose-start. The parent receives only the
 *  cleaned list (non-blank, http(s)-shaped); invalid rows stay visible with a
 *  hint but are excluded from the emitted value. */

let _seq = 0;
const nextId = (): string => `src-${_seq++}`;

interface Row {
  id: string;
  url: string;
}

const isHttp = (u: string): boolean => /^https?:\/\//i.test(u.trim());
const clean = (rows: Row[]): string[] =>
  rows.map((r) => r.url.trim()).filter((u) => u !== "" && isHttp(u));

export function SourceUrlsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
}): JSX.Element {
  const [rows, setRows] = useState<Row[]>(
    value.length ? value.map((url) => ({ id: nextId(), url })) : [{ id: nextId(), url: "" }],
  );

  const emit = (next: Row[]): void => {
    setRows(next);
    onChange(clean(next));
  };
  const setUrl = (id: string, url: string): void =>
    emit(rows.map((r) => (r.id === id ? { ...r, url } : r)));
  const addRow = (): void => setRows((rs) => [...rs, { id: nextId(), url: "" }]);
  const removeRow = (id: string): void => {
    const next = rows.filter((r) => r.id !== id);
    emit(next.length ? next : [{ id: nextId(), url: "" }]);
  };

  const anyInvalid = rows.some((r) => r.url.trim() !== "" && !isHttp(r.url));

  return (
    <div>
      <span className="nb-label">
        Source URLs <span className="text-muted font-normal">(optional)</span>
      </span>
      <p className="text-xs text-muted mb-1 leading-snug">
        Paste a README, release notes, or repo URL — the first draft is written from it.
      </p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2">
            <input
              type="url"
              aria-label={`Source URL ${i + 1}`}
              className="nb-input w-full"
              placeholder="https://github.com/you/project"
              value={r.url}
              onChange={(e) => setUrl(r.id, e.target.value)}
            />
            {rows.length > 1 && (
              <button
                type="button"
                aria-label={`Remove source URL ${i + 1}`}
                className="nb-btn nb-btn-ghost"
                onClick={() => removeRow(r.id)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {anyInvalid && (
          <p className="text-xs" style={{ color: "#92600a" }}>
            Each source must start with http:// or https://
          </p>
        )}
        {rows.length < 10 && (
          <button type="button" className="nb-btn nb-btn-ghost text-sm" onClick={addRow}>
            + Add source
          </button>
        )}
      </div>
    </div>
  );
}
