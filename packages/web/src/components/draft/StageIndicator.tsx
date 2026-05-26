import type { DraftStage } from "../../api/drafts";

interface StageIndicatorProps {
  current: DraftStage;
  onGoTo: (stage: DraftStage) => void;
}

const STAGES: { id: DraftStage; label: string }[] = [
  { id: "idea", label: "1. Idea" },
  { id: "outline", label: "2. Outline" },
  { id: "sections", label: "3. Sections" },
];

export function StageIndicator({ current, onGoTo }: StageIndicatorProps): JSX.Element {
  const currentIdx = STAGES.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-2">
      {STAGES.map((s, i) => {
        const isActive = i === currentIdx;
        const isPast = i < currentIdx;
        const isClickable = isPast;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => isClickable && onGoTo(s.id)}
              disabled={!isClickable && !isActive}
              className={`px-3 py-1 rounded text-sm ${
                isActive
                  ? "bg-emerald-700 text-emerald-50"
                  : isPast
                    ? "bg-slate-700 text-slate-300 hover:bg-slate-600 cursor-pointer"
                    : "bg-slate-800 text-slate-500 cursor-default"
              }`}
            >
              {s.label}
            </button>
            {i < STAGES.length - 1 && <span className="text-slate-600">—</span>}
          </div>
        );
      })}
    </div>
  );
}
