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
    <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-1 pt-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="text-slate-500 hover:text-slate-300 disabled:opacity-30 text-xs leading-none"
            aria-label="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="text-slate-500 hover:text-slate-300 disabled:opacity-30 text-xs leading-none"
            aria-label="Move down"
          >
            ▼
          </button>
        </div>
        <div className="flex-1 space-y-2">
          <input
            type="text"
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Section title"
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 text-sm font-medium"
          />
          <textarea
            value={section.brief}
            onChange={(e) => onChange({ ...section, brief: e.target.value })}
            placeholder="Brief description of this section…"
            rows={2}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-300 text-sm resize-none"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-slate-500 hover:text-red-400 text-sm pt-0.5"
          aria-label="Remove section"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
