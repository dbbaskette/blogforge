import { useState } from "react";

import { deleteHeroImage, generateHeroImage, heroImageUrl } from "../../api/drafts";
import { useElapsed } from "../../hooks/useElapsed";

interface HeroImageProps {
  draftId: string;
  /** Current hero image key from the draft (null when none). */
  heroKey: string | null;
  /** Called after generate/remove so the parent can refetch the draft. */
  onChanged: () => void;
}

/** AI hero image for the draft: generate (Google Imagen), preview, regenerate,
 * remove. Shown above the section workspace. */
export function HeroImage({ draftId, heroKey, onChanged }: HeroImageProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const secs = useElapsed(busy);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await generateHeroImage(draftId, prompt.trim());
      setShowPrompt(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await deleteHeroImage(draftId);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (heroKey) {
    return (
      <figure className="nb-card overflow-hidden p-0">
        <img
          src={heroImageUrl(draftId, heroKey)}
          alt="Draft hero"
          className="w-full aspect-[16/9] object-cover block"
        />
        <figcaption className="flex items-center justify-between gap-2 px-4 py-2 border-t border-rule">
          <span className="text-xs text-muted">Hero image</span>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-rose-ink">{error}</span>}
            <button type="button" onClick={generate} disabled={busy} className="nb-btn nb-btn-sm">
              {busy ? `Working… ${secs}s` : "Regenerate"}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="nb-btn nb-btn-ghost nb-btn-sm"
            >
              Remove
            </button>
          </div>
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="nb-card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-ink">Hero image</p>
          <p className="text-xs text-muted mt-0.5">
            Generate an AI banner image for this post (Google Imagen).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            className="nb-btn nb-btn-ghost nb-btn-sm"
          >
            {showPrompt ? "Hide prompt" : "Custom prompt"}
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="nb-btn nb-btn-primary nb-btn-sm"
          >
            {busy ? `Generating… ${secs}s` : "Generate hero image"}
          </button>
        </div>
      </div>
      {busy && <p className="text-xs text-muted mt-2">This can take 20–30s.</p>}
      {showPrompt && (
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Describe the image you want (leave blank to derive it from the title)…"
          className="nb-textarea mt-3 text-sm"
        />
      )}
      {error && <p className="text-xs text-rose-ink mt-2">{error}</p>}
    </div>
  );
}
