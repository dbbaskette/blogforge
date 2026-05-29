import type { Draft, DraftStage } from "../../api/drafts";

interface StageNavProps {
  draft: Draft;
  onJump: (stage: DraftStage) => void;
}

const STEPS: { stage: DraftStage; label: string }[] = [
  { stage: "research", label: "Talk it through" },
  { stage: "outline", label: "Outline" },
  { stage: "sections", label: "Draft" },
];

/** A breadcrumb of the three writing stages. Reached stages are clickable —
 * jump back to "Talk it through" to rework, or forward without losing work.
 * Research is always reachable; outline needs an outline; draft needs sections. */
export function StageNav({ draft, onJump }: StageNavProps): JSX.Element {
  const reachable = (stage: DraftStage): boolean => {
    if (stage === "research") return true;
    if (stage === "outline") return draft.outline != null;
    return draft.sections.length > 0;
  };

  return (
    <nav aria-label="Writing stage" className="flex items-center gap-1 mb-5 text-sm">
      {STEPS.map((step, i) => {
        const current = draft.stage === step.stage;
        const canJump = !current && reachable(step.stage);
        return (
          <div key={step.stage} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="text-muted-2 px-0.5">
                ›
              </span>
            )}
            <button
              type="button"
              disabled={!canJump}
              aria-current={current ? "step" : undefined}
              onClick={() => canJump && onJump(step.stage)}
              className={
                current
                  ? "rounded-nb-sm bg-cobalt-50 text-cobalt-700 font-semibold px-2.5 py-1"
                  : canJump
                    ? "rounded-nb-sm px-2.5 py-1 text-muted hover:text-cobalt-700 hover:bg-card-2 transition-colors"
                    : "rounded-nb-sm px-2.5 py-1 text-muted-2 cursor-default"
              }
            >
              {step.label}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
