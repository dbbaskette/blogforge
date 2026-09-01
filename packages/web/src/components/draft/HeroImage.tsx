import { useState } from "react";

import { type HeroTheme, deleteHeroImage, generateHeroImage, heroImageUrl } from "../../api/drafts";
import { useElapsed } from "../../hooks/useElapsed";
import { ErrorNotice } from "../ui/ErrorNotice";

interface HeroImageProps {
  draftId: string;
  /** Current hero image key from the draft (null when none). */
  heroKey: string | null;
  /** Called after generate/remove so the parent can refetch the draft. */
  onChanged: () => void;
}

const THEMES: Array<{ id: HeroTheme; label: string; description: string }> = [
  { id: "editorial", label: "Editorial", description: "Polished and cinematic" },
  { id: "fun", label: "Fun", description: "Playful and colorful" },
  { id: "space", label: "Space", description: "Cosmic and imaginative" },
  { id: "minimal", label: "Minimal", description: "Clean and focused" },
];

/** AI hero image for the draft: generate, preview, regenerate, and remove. */
export function HeroImage({ draftId, heroKey, onChanged }: HeroImageProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [errorOperation, setErrorOperation] = useState("generating your hero image");
  const [theme, setTheme] = useState<HeroTheme>("editorial");
  const [direction, setDirection] = useState("");
  const secs = useElapsed(busy);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setErrorOperation("generating your hero image");
    try {
      await generateHeroImage(draftId, { theme, direction: direction.trim() });
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setErrorOperation("removing your hero image");
    try {
      await deleteHeroImage(draftId);
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="nb-card overflow-hidden p-0" aria-labelledby="hero-image-heading">
      {heroKey && (
        <img
          src={heroImageUrl(draftId, heroKey)}
          alt="Draft hero"
          className="w-full aspect-[16/9] object-cover block"
        />
      )}

      <div className="p-5 space-y-4 border-t border-rule first:border-t-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 id="hero-image-heading" className="text-sm font-medium text-ink">
              Hero image
            </h3>
            <p className="text-xs text-muted mt-0.5">
              BlogForge uses specific facts from your article to create a distinctive banner.
            </p>
          </div>
          {heroKey && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="nb-btn nb-btn-ghost nb-btn-sm"
            >
              Remove
            </button>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wider text-ink-2">
            Theme
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEMES.map((option) => {
              const selected = theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={selected}
                  onClick={() => setTheme(option.id)}
                  disabled={busy}
                  className={`rounded-nb-sm border px-3 py-2 text-left transition-colors ${
                    selected
                      ? "border-ink bg-ink text-paper"
                      : "border-rule bg-paper hover:border-ink-2"
                  }`}
                >
                  <span className="block text-xs font-semibold">{option.label}</span>
                  <span
                    className={`block text-[11px] mt-0.5 ${selected ? "text-paper" : "text-muted"}`}
                  >
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`hero-direction-${draftId}`} className="text-xs font-semibold text-ink-2">
            Image direction
          </label>
          <textarea
            id={`hero-direction-${draftId}`}
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            rows={2}
            maxLength={600}
            disabled={busy}
            placeholder="Optional: describe the mood, colors, medium, or composition you want."
            className="nb-textarea mt-1.5 text-sm"
          />
          <p className="text-[11px] text-muted mt-1">
            This guides the look. Article facts remain the subject of the image.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted">
            {busy ? `Creating image... ${secs}s` : "Wide 16:9 image with no text or logos"}
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="nb-btn nb-btn-primary nb-btn-sm"
          >
            {busy ? "Creating..." : heroKey ? "Regenerate" : "Generate hero image"}
          </button>
        </div>

        {error !== null && (
          <ErrorNotice
            error={error}
            operation={errorOperation}
            onRetry={errorOperation.startsWith("generating") ? () => void generate() : undefined}
            onDismiss={() => setError(null)}
          />
        )}
      </div>
    </section>
  );
}
