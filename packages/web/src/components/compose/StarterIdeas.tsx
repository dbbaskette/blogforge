/**
 * A curated starter — either seeds a topic (express/propose) or drops a ready
 * outline skeleton (outline mode). Picking one selects the mode AND pre-fills
 * the relevant field, so a first-timer with no saved templates has a running
 * start instead of a blank box.
 */
export type Starter =
  | { id: string; icon: string; label: string; blurb: string; mode: "outline"; outline: string }
  | {
      id: string;
      icon: string;
      label: string;
      blurb: string;
      mode: "express" | "propose";
      topic: string;
    };

const STARTERS: Starter[] = [
  {
    id: "how-to",
    icon: "🛠",
    label: "How-to guide",
    blurb: "Teach one thing, step by step.",
    mode: "outline",
    outline:
      "# How to <do the thing>\n" +
      "## Why this matters\n" +
      "## What you'll need\n" +
      "## Step 1: <first step>\n" +
      "## Step 2: <next step>\n" +
      "## Common mistakes to avoid\n" +
      "## Wrapping up",
  },
  {
    id: "announcement",
    icon: "📣",
    label: "Product announcement",
    blurb: "Launch something and say why it matters.",
    mode: "express",
    topic: "Announcing <product>: what it is, who it's for, and why we built it",
  },
  {
    id: "hot-take",
    icon: "🔥",
    label: "Opinion / hot take",
    blurb: "Stake out a contrarian position.",
    mode: "express",
    topic: "A contrarian take on <topic>: why the common wisdom is wrong",
  },
  {
    id: "tutorial",
    icon: "🧭",
    label: "Tutorial walkthrough",
    blurb: "Build something end to end.",
    mode: "outline",
    outline:
      "# Build <thing> from scratch\n" +
      "## What we're building\n" +
      "## Prerequisites\n" +
      "## Setting up\n" +
      "## The core implementation\n" +
      "## Testing it\n" +
      "## Where to go next",
  },
  {
    id: "listicle",
    icon: "🔢",
    label: "Listicle",
    blurb: "A punchy numbered rundown.",
    mode: "outline",
    outline:
      "# <N> <things> that <deliver a benefit>\n" +
      "## 1. <first item>\n" +
      "## 2. <second item>\n" +
      "## 3. <third item>\n" +
      "## The one that matters most",
  },
  {
    id: "story",
    icon: "📖",
    label: "Lessons learned",
    blurb: "A story with a takeaway.",
    mode: "propose",
    topic: "What I learned from <an experience> and what you can take from it",
  },
];

export function StarterIdeas({ onPick }: { onPick: (s: Starter) => void }): JSX.Element {
  return (
    <div>
      <p className="nb-label mb-2">Not sure where to start? Try a starter</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {STARTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className="glass-card text-left p-3 hover:shadow-glass-lg transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500"
          >
            <p className="text-sm font-medium text-ink">
              <span aria-hidden="true">{s.icon}</span> {s.label}
            </p>
            <p className="text-xs text-muted leading-snug mt-0.5">{s.blurb}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
