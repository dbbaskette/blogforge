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
      className="fixed inset-0 z-50 flex justify-end bg-ink/70 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="w-[420px] max-w-full bg-surface border-l border-rule-2 h-full overflow-y-auto shadow-2xl shadow-ink m-0 p-0 text-cream animate-slide-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="Lint results"
      >
        <header className="px-6 pt-6 pb-4 border-b border-rule">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400">
              The proofreader's bench
            </p>
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[10px] uppercase tracking-wide-3 text-muted hover:text-vermilion-400"
              aria-label="Close"
            >
              close ✕
            </button>
          </div>
          <h2 className="font-display text-cream-2 text-2xl tracking-tight-2 mt-1">Lint results</h2>
        </header>

        {loading && (
          <p className="px-6 py-12 text-center font-mono text-[10px] uppercase tracking-wide-3 text-muted">
            running lint…
          </p>
        )}

        {error && (
          <p className="px-6 py-4 text-vermilion-300 text-sm border-l-2 border-vermilion ml-4 my-4">
            {error}
          </p>
        )}

        {!loading && !error && (
          <div className="p-6 space-y-7">
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-cream-2 text-lg tracking-tight-2">Violations</h3>
                <span className="font-mono-num text-xs text-vermilion-400">
                  {violations.length.toString().padStart(2, "0")}
                </span>
              </div>
              {violations.length === 0 && (
                <p className="font-prose italic text-muted text-sm">No violations — clean copy.</p>
              )}
              <ul className="space-y-2">
                {violations.map((v, i) => (
                  <li
                    key={itemKey(v, "violation", i)}
                    className="border-l-2 border-vermilion pl-3 py-1 text-sm text-cream/85"
                  >
                    {v.rule && (
                      <span className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-400 mr-2">
                        [{v.rule}]
                      </span>
                    )}
                    <span className="font-prose">{v.message ?? v.text ?? JSON.stringify(v)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="rule" />

            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-cream-2 text-lg tracking-tight-2">
                  Positive hits
                </h3>
                <span className="font-mono-num text-xs text-teal-400">
                  {hits.length.toString().padStart(2, "0")}
                </span>
              </div>
              {hits.length === 0 && (
                <p className="font-prose italic text-muted text-sm">No positive style hits yet.</p>
              )}
              <ul className="space-y-2">
                {hits.map((h, i) => (
                  <li
                    key={itemKey(h, "hit", i)}
                    className="border-l-2 border-teal pl-3 py-1 text-sm text-cream/85"
                  >
                    {h.rule && (
                      <span className="font-mono text-[10px] uppercase tracking-wide-3 text-teal mr-2">
                        [{h.rule}]
                      </span>
                    )}
                    <span className="font-prose">{h.message ?? h.text ?? JSON.stringify(h)}</span>
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
