import { useEffect, useState } from "react";

import { type RepurposeFormat, listRepurposeFormats, repurposeDraft } from "../../api/drafts";
import { Icon } from "../ui/Icon";
import { useDialogA11y } from "../ui/useDialogA11y";

interface RepurposePanelProps {
  draftId: string;
  onClose: () => void;
}

export function RepurposePanel({ draftId, onClose }: RepurposePanelProps): JSX.Element {
  const [formats, setFormats] = useState<RepurposeFormat[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    listRepurposeFormats()
      .then(setFormats)
      .catch((e: Error) => setError(e.message));
  }, []);

  const run = async (formatId: string): Promise<void> => {
    setActive(formatId);
    setLoading(true);
    setError(null);
    setResult("");
    setCopied(false);
    try {
      const { text } = await repurposeDraft(draftId, formatId);
      setResult(text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        className="w-[480px] max-w-full bg-canvas border-l border-rule-2 h-full overflow-y-auto shadow-nb-pop m-0 p-0 text-ink animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
        aria-label="Repurpose draft"
      >
        <header className="px-6 pt-6 pb-4 border-b border-rule bg-white sticky top-0 z-10">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
              Repurpose
            </p>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              <Icon name="x" size={16} title="" />
            </button>
          </div>
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight mt-1">
            One post, every channel
          </h2>
          <p className="text-sm text-muted mt-1">
            Spin this draft into another format — in your voice.
          </p>
        </header>

        <div className="p-6 space-y-5">
          <div className="flex flex-wrap gap-2">
            {formats.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => run(f.id)}
                disabled={loading}
                aria-pressed={active === f.id}
                className={`nb-btn nb-btn-sm ${active === f.id ? "nb-btn-primary" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error && (
            <div
              className="px-3 py-2 rounded-nb-sm text-sm"
              style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
            >
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-3 py-12 justify-center text-amber">
              <span
                aria-hidden
                className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
              />
              <span className="text-sm font-medium">Repurposing…</span>
            </div>
          )}

          {!loading && result && (
            <section className="animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {formats.find((f) => f.id === active)?.label ?? "Result"}
                </h3>
                <button type="button" onClick={copy} className="nb-btn nb-btn-sm">
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="nb-card p-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-2">
                {result}
              </pre>
            </section>
          )}

          {!loading && !result && !error && (
            <p className="text-sm text-muted italic font-serif py-8 text-center">
              Pick a format to generate.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
