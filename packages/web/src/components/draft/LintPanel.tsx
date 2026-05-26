import { useEffect, useState } from "react";

import { lintDraft } from "../../api/drafts";

interface LintItem {
  text?: string;
  message?: string;
  rule?: string;
  [key: string]: unknown;
}

interface LintPanelProps {
  draftId: string;
  onClose: () => void;
}

function itemKey(item: LintItem, prefix: string, idx: number): string {
  const hint = item.rule ?? item.message ?? item.text ?? String(idx);
  return `${prefix}-${idx}-${hint}`;
}

export function LintPanel({ draftId, onClose }: LintPanelProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [violations, setViolations] = useState<LintItem[]>([]);
  const [hits, setHits] = useState<LintItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    lintDraft(draftId)
      .then((result) => {
        setViolations(result.violations as LintItem[]);
        setHits(result.hits as LintItem[]);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [draftId]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="w-96 max-w-full bg-slate-900 border-l border-slate-700 h-full overflow-y-auto shadow-2xl m-0 p-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="Lint results"
      >
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold text-slate-100">Lint results</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-lg"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && <div className="px-4 py-6 text-slate-500 text-sm">Running lint…</div>}

        {error && <div className="px-4 py-4 text-red-400 text-sm">{error}</div>}

        {!loading && !error && (
          <div className="p-4 space-y-4">
            <section>
              <h3 className="text-sm font-medium text-red-300 mb-2">
                Violations ({violations.length})
              </h3>
              {violations.length === 0 && (
                <p className="text-slate-500 text-xs">No violations found.</p>
              )}
              <ul className="space-y-2">
                {violations.map((v, i) => (
                  <li
                    key={itemKey(v, "violation", i)}
                    className="bg-slate-950 border border-red-900/50 rounded p-2 text-xs text-slate-300"
                  >
                    {v.rule && <span className="text-red-400 font-mono mr-2">[{v.rule}]</span>}
                    {v.message ?? v.text ?? JSON.stringify(v)}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="text-sm font-medium text-emerald-300 mb-2">
                Positive hits ({hits.length})
              </h3>
              {hits.length === 0 && (
                <p className="text-slate-500 text-xs">No positive style hits found.</p>
              )}
              <ul className="space-y-2">
                {hits.map((h, i) => (
                  <li
                    key={itemKey(h, "hit", i)}
                    className="bg-slate-950 border border-emerald-900/50 rounded p-2 text-xs text-slate-300"
                  >
                    {h.rule && <span className="text-emerald-400 font-mono mr-2">[{h.rule}]</span>}
                    {h.message ?? h.text ?? JSON.stringify(h)}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </dialog>
    </div>
  );
}
