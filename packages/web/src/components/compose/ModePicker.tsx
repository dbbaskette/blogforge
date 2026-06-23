export type ComposeMode = "outline" | "propose" | "express" | "blank";

const MODES: { id: ComposeMode; accent: string; icon: string; title: string; blurb: string }[] = [
  { id: "outline", accent: "accent-blue", icon: "📋", title: "I have an outline", blurb: "Paste your structure — AI writes the full draft from it." },
  { id: "propose", accent: "accent-teal", icon: "💬", title: "Help me shape it", blurb: "Describe the topic — get an outline to tweak, then AI writes it." },
  { id: "express", accent: "accent-amber", icon: "⚡", title: "Just write it", blurb: "A topic in, a full draft out — one shot." },
  { id: "blank", accent: "accent-green", icon: "📝", title: "Blank page", blurb: "Start empty and write yourself, with inline AI tools." },
];

export function ModePicker({
  active,
  onPick,
}: {
  active: ComposeMode | null;
  onPick: (m: ComposeMode) => void;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="How do you want to start?"
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={active === m.id}
          onClick={() => onPick(m.id)}
          className={`glass-card ${m.accent} text-left p-4 transition-shadow hover:shadow-glass-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500 focus-visible:ring-offset-2 ${
            active === m.id ? "ring-2 ring-cobalt-400" : ""
          }`}
        >
          <p className="font-semibold text-ink">
            <span aria-hidden="true">{m.icon}</span> {m.title}
          </p>
          <p className="text-sm text-muted mt-1 leading-snug">{m.blurb}</p>
        </button>
      ))}
    </div>
  );
}
