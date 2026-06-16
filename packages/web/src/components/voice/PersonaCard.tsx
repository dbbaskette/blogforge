import { type FocusEvent, useState } from "react";

import { updatePersona } from "../../api/voice";
import type { VoiceProfile } from "../../api/voice";

interface PersonaCardProps {
  profile: VoiceProfile;
  onChange: (updated: VoiceProfile) => void;
}

export function PersonaCard({ profile, onChange }: PersonaCardProps): JSX.Element {
  const [identity, setIdentity] = useState(profile.persona_identity);
  const [oneLine, setOneLine] = useState(profile.persona_one_line);
  const [tone, setTone] = useState(profile.persona_tone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePersona({ identity, one_line: oneLine, tone });
      onChange(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleBlur = (e: FocusEvent<HTMLTextAreaElement | HTMLInputElement>): void => {
    // Only save on blur if value actually changed from profile
    const changed =
      identity !== profile.persona_identity ||
      oneLine !== profile.persona_one_line ||
      tone !== profile.persona_tone;
    if (changed && e.currentTarget) {
      void save();
    }
  };

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Identity</h2>
      <div className="nb-card p-6 space-y-4">
        <div>
          <label htmlFor="persona-identity" className="nb-label">
            Who you are
          </label>
          <textarea
            id="persona-identity"
            rows={3}
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            onBlur={handleBlur}
            placeholder="Describe your professional identity and writing persona…"
            className="nb-textarea"
          />
        </div>
        <div>
          <label htmlFor="persona-one-line" className="nb-label">
            One-liner
          </label>
          <input
            id="persona-one-line"
            type="text"
            value={oneLine}
            onChange={(e) => setOneLine(e.target.value)}
            onBlur={handleBlur}
            placeholder="A single sentence that captures your voice"
            className="nb-input"
          />
        </div>
        <div>
          <label htmlFor="persona-tone" className="nb-label">
            Tone
          </label>
          <input
            id="persona-tone"
            type="text"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            onBlur={handleBlur}
            placeholder="e.g. warm, direct, analytical, conversational"
            className="nb-input"
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

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="nb-btn nb-btn-primary nb-btn-sm"
          >
            {saving ? "Saving…" : "Save identity"}
          </button>
          {savedFlash && (
            <span
              className="text-xs font-medium"
              style={{ color: "#1f7752" }}
            >
              Saved
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
