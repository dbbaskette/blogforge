import type { OutlineSection } from "../../api/drafts";

interface OutlineSectionCardProps {
  section: OutlineSection;
  index: number;
  total: number;
  onChange: (updated: OutlineSection) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function OutlineSectionCard({
  section,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: OutlineSectionCardProps): JSX.Element {
  return (
    <article className="group border-t border-rule first:border-t-0 py-5 grid grid-cols-[3rem_1fr_auto] gap-5 items-start">
      {/* Big numeral + reorder controls */}
      <div className="flex flex-col items-start gap-1">
        <span className="font-display-tight font-mono-num text-muted-2 text-3xl leading-none group-hover:text-vermilion-400 transition-colors">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="mt-1 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="text-muted-2 hover:text-cream disabled:opacity-20 text-[10px] leading-none px-1 py-0.5"
            aria-label="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="text-muted-2 hover:text-cream disabled:opacity-20 text-[10px] leading-none px-1 py-0.5"
            aria-label="Move down"
          >
            ▼
          </button>
        </div>
      </div>

      {/* Editable title + brief */}
      <div className="space-y-2 min-w-0">
        <input
          type="text"
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
          placeholder="Section title"
          className="w-full bg-transparent border-0 border-b border-transparent hover:border-rule focus:border-vermilion-400 px-0 py-1 text-cream-2 font-display text-xl tracking-tight-2 focus:outline-none transition-colors"
        />
        <textarea
          value={section.brief}
          onChange={(e) => onChange({ ...section, brief: e.target.value })}
          placeholder="What does this section do? A sentence or two of brief."
          rows={2}
          className="w-full bg-transparent border-0 border-l-2 border-rule pl-3 py-0.5 text-cream/75 font-prose text-sm italic placeholder:text-muted-2 focus:border-vermilion-400 focus:outline-none resize-none transition-colors"
        />
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity font-mono text-[10px] uppercase tracking-wide-3 text-muted hover:text-vermilion-400 self-start pt-2"
        aria-label="Remove section"
      >
        discard
      </button>
    </article>
  );
}
