import { useState } from "react";

import type { Draft, IdeaInput } from "../../api/drafts";

interface IdeaPanelProps {
  idea: IdeaInput;
  onChange: (idea: IdeaInput) => void;
  onAdvance: () => Promise<void>;
  draft: Draft;
}

export function IdeaPanel({ idea, onChange, onAdvance }: IdeaPanelProps): JSX.Element {
  const [newBullet, setNewBullet] = useState("");
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bullets = idea.bullets ?? [];

  const addBullet = (): void => {
    const trimmed = newBullet.trim();
    if (!trimmed) return;
    onChange({ ...idea, bullets: [...bullets, trimmed] });
    setNewBullet("");
  };

  const removeBullet = (idx: number): void => {
    onChange({ ...idea, bullets: bullets.filter((_, i) => i !== idx) });
  };

  const handleAdvance = async (): Promise<void> => {
    setAdvancing(true);
    setError(null);
    try {
      await onAdvance();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdvancing(false);
    }
  };

  const canAdvance = idea.topic.trim() && idea.pack_slug && idea.model && !advancing;

  return (
    <section className="nb-card p-7 space-y-5 animate-fade-up">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
          Step 1 · The seed
        </p>
        <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">Plant the idea.</h2>
        <p className="text-sm text-muted mt-1.5">
          What's the piece about? Add key points if you have them — Pencraft will use them to shape
          an outline.
        </p>
      </header>

      <div>
        <label htmlFor="idea-topic" className="nb-label">
          Topic
        </label>
        <input
          id="idea-topic"
          type="text"
          value={idea.topic}
          onChange={(e) => onChange({ ...idea, topic: e.target.value })}
          placeholder="Building agents that don't suck"
          className="nb-input text-base"
        />
      </div>

      <div>
        <label htmlFor="idea-bullets" className="nb-label">
          Key points
        </label>
        {bullets.length > 0 && (
          <ol className="space-y-1.5 mb-2 border-l border-rule pl-4">
            {bullets.map((b, i) => (
              <li key={`${b}-${String(i)}`} className="flex items-baseline gap-3 group/bullet">
                <span className="font-mono text-[11px] text-muted-2 w-6 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-serif text-[15px] text-ink-2 flex-1 leading-snug">{b}</span>
                <button
                  type="button"
                  onClick={() => removeBullet(i)}
                  className="opacity-0 group-hover/bullet:opacity-100 focus:opacity-100 transition-opacity text-xs text-muted hover:text-rose"
                  aria-label="Remove bullet"
                >
                  remove
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex gap-2">
          <input
            id="idea-bullets"
            type="text"
            value={newBullet}
            onChange={(e) => setNewBullet(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addBullet();
              }
            }}
            placeholder="A thread to pull on…"
            className="nb-input"
          />
          <button type="button" onClick={addBullet} className="nb-btn nb-btn-sm">
            Add
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="idea-notes" className="nb-label">
          Notes (optional)
        </label>
        <textarea
          id="idea-notes"
          value={idea.notes ?? ""}
          onChange={(e) => onChange({ ...idea, notes: e.target.value })}
          placeholder="Any extra context — angle, tone, audience…"
          rows={3}
          className="nb-textarea font-serif text-[15px]"
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

      <div className="pt-4 border-t border-rule flex justify-end">
        <button
          type="button"
          onClick={handleAdvance}
          disabled={!canAdvance}
          className="nb-btn nb-btn-primary"
        >
          {advancing ? "Generating outline…" : "Generate outline →"}
        </button>
      </div>
    </section>
  );
}
