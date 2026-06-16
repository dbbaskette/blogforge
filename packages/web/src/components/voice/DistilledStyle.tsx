import { useState } from "react";

import { distill, updateDistilled } from "../../api/voice";
import type { VoiceProfile } from "../../api/voice";

interface DistilledStyleProps {
  profile: VoiceProfile;
  onChange: (updated: VoiceProfile) => void;
}

export function DistilledStyle({ profile, onChange }: DistilledStyleProps): JSX.Element {
  const [text, setText] = useState(profile.distilled_style_md);
  const [saving, setSaving] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const save = async (): Promise<void> => {
    if (text === profile.distilled_style_md) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDistilled(text);
      onChange(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRedistill = async (): Promise<void> => {
    setDistilling(true);
    setError(null);
    try {
      const updated = await distill();
      setText(updated.distilled_style_md);
      onChange(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDistilling(false);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Distilled style</h2>
      <div className="nb-card p-6 space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          A distilled summary of your writing style derived from your samples. You can edit it
          manually or re-distill from your samples using AI.
        </p>

        <div>
          <label htmlFor="distilled-style" className="nb-label">
            Style guide (Markdown)
          </label>
          <textarea
            id="distilled-style"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void save()}
            placeholder="Your distilled writing style will appear here after distillation…"
            className="nb-textarea font-mono text-sm"
          />
        </div>

        {error && (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm"
            style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || text === profile.distilled_style_md}
            className="nb-btn nb-btn-primary nb-btn-sm"
          >
            {saving ? "Saving…" : "Save style"}
          </button>
          <button
            type="button"
            onClick={() => void handleRedistill()}
            disabled={distilling || saving}
            className="nb-btn nb-btn-sm"
          >
            {distilling ? (
              <>
                <span
                  aria-hidden
                  className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"
                />
                Distilling…
              </>
            ) : (
              "Re-distill from samples"
            )}
          </button>
          {savedFlash && (
            <span className="text-xs font-medium" style={{ color: "#1f7752" }}>
              Saved
            </span>
          )}
        </div>

        {profile.distilled_at && (
          <p className="text-xs text-muted">
            Last distilled:{" "}
            <span className="font-medium text-ink-2">
              {new Date(profile.distilled_at).toLocaleString()}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
