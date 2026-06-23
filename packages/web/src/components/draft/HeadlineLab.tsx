import { useState } from "react";

import { generateHeadlines } from "../../api/drafts";
import { Icon } from "../ui/Icon";
import { useDialogA11y } from "../ui/useDialogA11y";

type Kind = "title" | "hook";

interface HeadlineLabProps {
  draftId: string;
  onApplyTitle: (title: string) => void;
  onApplyHook: (hook: string) => void;
  onClose: () => void;
}

/** Generate alternative titles or opening hooks and apply the best one.
 * Launched from the outline panel. */
export function HeadlineLab({
  draftId,
  onApplyTitle,
  onApplyHook,
  onClose,
}: HeadlineLabProps): JSX.Element {
  const [kind, setKind] = useState<Kind>("title");
  const [options, setOptions] = useState<Record<Kind, string[]>>({ title: [], hook: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (k: Kind): Promise<void> => {
    setKind(k);
    setLoading(true);
    setError(null);
    try {
      const { options: opts } = await generateHeadlines(draftId, k);
      setOptions((prev) => ({ ...prev, [k]: opts }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const current = options[kind];
  const panelRef = useDialogA11y(true, onClose);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-ink/30 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="w-[460px] max-w-full bg-canvas border-l border-rule-2 h-full overflow-y-auto shadow-nb-pop m-0 p-0 text-ink animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
        aria-label="Headline and hook lab"
      >
        <header className="px-6 pt-6 pb-4 border-b border-rule bg-white sticky top-0 z-10">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
              Headline lab
            </p>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              <Icon name="x" size={16} title="" />
            </button>
          </div>
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight mt-1">
            Find a sharper opening
          </h2>
          <div className="flex border-b border-rule mt-4 -mb-4" role="tablist">
            {(["title", "hook"] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={`flex-1 py-2 text-sm font-medium border-b-2 capitalize transition-colors ${
                  kind === k
                    ? "border-cobalt-500 text-cobalt-700"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {k === "title" ? "Titles" : "Hooks"}
              </button>
            ))}
          </div>
        </header>

        <div className="p-6 space-y-4">
          <button
            type="button"
            onClick={() => run(kind)}
            disabled={loading}
            className="nb-btn nb-btn-primary nb-btn-sm w-full"
          >
            {loading
              ? "Generating…"
              : current.length > 0
                ? `Regenerate ${kind === "title" ? "titles" : "hooks"}`
                : `Generate ${kind === "title" ? "titles" : "hooks"}`}
          </button>

          {error && (
            <div
              className="px-3 py-2 rounded-nb-sm text-sm"
              style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
            >
              {error}
            </div>
          )}

          {!loading && current.length === 0 && !error && (
            <p className="text-sm text-muted italic font-serif py-6 text-center">
              Generate a batch of {kind === "title" ? "title" : "hook"} options to choose from.
            </p>
          )}

          <ul className="space-y-2">
            {current.map((opt, i) => (
              <li key={`${i}-${opt.slice(0, 24)}`} className="nb-card p-3">
                <p className={kind === "hook" ? "font-serif text-[15px] leading-snug" : "text-sm"}>
                  {opt}
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(opt)}
                    className="nb-btn nb-btn-ghost nb-btn-sm"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (kind === "title") onApplyTitle(opt);
                      else onApplyHook(opt);
                      onClose();
                    }}
                    className="nb-btn nb-btn-sm"
                  >
                    Use this →
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
