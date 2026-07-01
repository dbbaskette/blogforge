export type ComposeMode = "outline" | "propose" | "express" | "blank" | "paste";

const MODES: {
  id: ComposeMode;
  accent: string;
  icon: string;
  title: string;
  blurb: string;
  badge?: string;
}[] = [
  {
    id: "express",
    accent: "accent-amber",
    icon: "⚡",
    title: "Just write it",
    blurb: "A topic in, a full draft out — one shot.",
    badge: "Fastest",
  },
  {
    id: "propose",
    accent: "accent-teal",
    icon: "💬",
    title: "Help me shape it",
    blurb: "Describe the topic — get an outline to tweak, then AI writes it.",
  },
  {
    id: "outline",
    accent: "accent-blue",
    icon: "📋",
    title: "I have an outline",
    blurb: "Paste your structure — AI writes the full draft from it.",
  },
  {
    id: "paste",
    accent: "accent-teal",
    icon: "📥",
    title: "I already wrote it",
    blurb: "Paste a finished draft and shape it with the editor tools.",
  },
  {
    id: "blank",
    accent: "accent-green",
    icon: "📝",
    title: "Blank page",
    blurb: "Start empty and write yourself, with inline AI tools.",
  },
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
          <p className="font-semibold text-ink flex items-center gap-2">
            <span>
              <span aria-hidden="true">{m.icon}</span> {m.title}
            </span>
            {m.badge && (
              <span className="text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-soft text-amber-ink">
                {m.badge}
              </span>
            )}
          </p>
          <p className="text-sm text-muted mt-1 leading-snug">{m.blurb}</p>
        </button>
      ))}
    </div>
  );
}
