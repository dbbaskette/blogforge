import { useState } from "react";
import { Link } from "react-router-dom";

import { auditionVoice } from "../../api/voice";

interface AuditionResult {
  original: string;
  rewritten: string;
}

export function VoiceAudition(): JSX.Element {
  const [text, setText] = useState("");
  const [result, setResult] = useState<AuditionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRewrite = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await auditionVoice(trimmed);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = (): void => {
    if (!result) return;
    void navigator.clipboard.writeText(result.rewritten);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const needsKey =
    error !== null && (error.includes("provider_missing_key") || error.includes("HTTP 400"));

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Try your voice</h2>
      <div className="nb-card p-6 space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          Paste a flat sentence or two and see it rewritten in your voice — using your persona,
          rules, and distilled style. A quick way to feel your fingerprint in action.
        </p>

        <div>
          <label htmlFor="audition-input" className="nb-label">
            Your text
          </label>
          <textarea
            id="audition-input"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a sentence or two…"
            className="nb-textarea text-sm"
          />
        </div>

        {error && (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm"
            style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
          >
            {needsKey ? (
              <>
                Rewriting needs a writing model. Add a provider key in{" "}
                <Link to="/settings" className="underline">
                  Settings
                </Link>{" "}
                → Provider API keys, or use the Tanzu model.
              </>
            ) : (
              error
            )}
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void handleRewrite()}
            disabled={busy || text.trim() === ""}
            className="nb-btn nb-btn-primary nb-btn-sm"
          >
            {busy ? (
              <>
                <span
                  aria-hidden
                  className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1"
                />
                Rewriting…
              </>
            ) : (
              "✨ Rewrite in my voice"
            )}
          </button>
        </div>

        {result && (
          <div className="grid gap-4 md:grid-cols-2 pt-1">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Original</p>
              <div className="rounded-nb-sm border border-rule bg-card-2 p-3">
                <p className="text-sm text-muted whitespace-pre-wrap leading-relaxed">
                  {result.original}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
                  In your voice
                </p>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="nb-btn nb-btn-sm"
                  aria-label="Copy rewritten text"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="rounded-nb-sm border border-cobalt-100 bg-cobalt-50 p-3">
                <p className="font-serif text-[15px] text-ink whitespace-pre-wrap leading-relaxed">
                  {result.rewritten}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
