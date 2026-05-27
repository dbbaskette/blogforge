import type { DraftStage } from "../../api/drafts";

interface StageIndicatorProps {
  current: DraftStage;
  onGoTo: (stage: DraftStage) => void;
}

const STAGES: { id: DraftStage; numeral: string; label: string }[] = [
  { id: "idea", numeral: "01", label: "Idea" },
  { id: "outline", numeral: "02", label: "Outline" },
  { id: "sections", numeral: "03", label: "Sections" },
];

export function StageIndicator({ current, onGoTo }: StageIndicatorProps): JSX.Element {
  const currentIdx = STAGES.findIndex((s) => s.id === current);
  return (
    <nav
      aria-label="Draft stage"
      className="flex items-baseline gap-5 border-y border-rule py-3 px-1 font-mono text-[11px] uppercase tracking-wide-3"
      data-testid="stage-indicator"
    >
      {STAGES.map((s, i) => {
        const isActive = i === currentIdx;
        const isPast = i < currentIdx;
        const isClickable = isPast;
        const stateClass = isActive
          ? "text-vermilion-400"
          : isPast
            ? "text-cream/70 hover:text-vermilion-400 cursor-pointer"
            : "text-muted-2 cursor-default";
        return (
          <div key={s.id} className="flex items-baseline gap-3">
            <button
              type="button"
              onClick={() => isClickable && onGoTo(s.id)}
              disabled={!isClickable && !isActive}
              aria-current={isActive ? "step" : undefined}
              data-stage={s.id}
              data-active={isActive ? "true" : "false"}
              className={`group inline-flex items-baseline gap-2 transition-colors ${stateClass}`}
            >
              <span className="font-mono-num text-muted-2 group-hover:text-vermilion-400 transition-colors">
                {s.numeral}
              </span>
              <span className="sr-only">{`${i + 1}. ${s.label}`}</span>
              <span aria-hidden className="relative">
                {s.label}
                <span
                  aria-hidden
                  className={`absolute left-0 right-0 -bottom-1 h-px bg-vermilion-400 origin-left transition-transform duration-300 ${
                    isActive ? "scale-x-100" : "scale-x-0"
                  }`}
                />
              </span>
            </button>
            {i < STAGES.length - 1 && (
              <span aria-hidden className="text-muted-2">
                ·
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
