import { useState } from "react";

import { type TopicIdea, sparkTopics } from "../../api/ideation";
import type { ComposeSettings } from "../../lib/composeDefaults";

/**
 * "Spark ideas" helper for the Express / Propose panels — the fix for the
 * blank-page problem. Generates voice-aware post ideas (optionally riffing on
 * whatever the writer has typed as a seed) and lets them click one to fill the
 * Topic box. Self-contained: only calls the API on button click.
 */
export function SparkIdeas({
  seed,
  settings,
  disabled = false,
  onPick,
}: {
  seed: string;
  settings: ComposeSettings;
  disabled?: boolean;
  onPick: (title: string) => void;
}): JSX.Element {
  const [ideas, setIdeas] = useState<TopicIdea[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function spark(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { topics } = await sparkTopics({
        seed: seed.trim(),
        provider: settings.provider,
        model: settings.model,
        use_voice_profile: settings.use_voice_profile,
        pack_slug: settings.pack_slug,
        n: 5,
      });
      setIdeas(topics);
      if (topics.length === 0) setError("No ideas came back — try again or add a hint.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="nb-btn text-sm"
        onClick={spark}
        disabled={busy || disabled}
        title={seed.trim() ? "Brainstorm angles on what you typed" : "Brainstorm post ideas"}
      >
        {busy ? "✨ Sparking…" : seed.trim() ? "✨ Spark angles" : "✨ Spark ideas"}
      </button>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {ideas.length > 0 && (
        <ul className="space-y-1.5">
          {ideas.map((idea) => (
            <li key={idea.title}>
              <button
                type="button"
                onClick={() => onPick(idea.title)}
                className="glass-card w-full text-left px-3 py-2 hover:shadow-glass-lg transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500"
              >
                <span className="text-sm font-medium text-ink">{idea.title}</span>
                {idea.angle && (
                  <span className="block text-xs text-muted leading-snug mt-0.5">{idea.angle}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
