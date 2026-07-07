/**
 * Slide-in Humanize panel — shell modeled on LintPanel, analyze-on-open +
 * panelCache logic modeled on OptimizePanel's GEO cache. Runs an on-demand
 * "sound human" pass at the chosen Light/Medium/Strong intensity, shows the
 * HumannessPulse readout, and lists the findings via HumanizeReviewRail.
 */

import { useCallback, useEffect, useState } from "react";

import type { Draft } from "../../api/drafts";
import { type HumanizeReport, type Intensity, analyzeHumanize } from "../../api/humanize";
import { getCached, hashDraftContent, setCached } from "../../lib/panelCache";
import { Icon } from "../ui/Icon";
import { useDialogA11y } from "../ui/useDialogA11y";
import { HumannessPulse } from "./HumannessPulse";
import { HumanizeReviewRail } from "./HumanizeReviewRail";

interface HumanizePanelProps {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onClose: () => void;
}

const INTENSITIES: { value: Intensity; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "/humanize/robot.png" },
  { value: "medium", label: "Medium", icon: "/humanize/half.png" },
  { value: "strong", label: "Strong", icon: "/humanize/human.png" },
];

const intensityKey = (draftId: string): string => `bf.humanize.intensity.${draftId}`;

function readSavedIntensity(draftId: string): Intensity {
  const saved = localStorage.getItem(intensityKey(draftId));
  return saved === "light" || saved === "medium" || saved === "strong" ? saved : "medium";
}

export function HumanizePanel({ draft, onSectionSave, onClose }: HumanizePanelProps): JSX.Element {
  const panelRef = useDialogA11y(true, onClose);
  const [intensity, setIntensity] = useState<Intensity>(() => readSavedIntensity(draft.id));
  const [report, setReport] = useState<HumanizeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // On mount and whenever intensity (or the draft's content) changes: reuse a
  // cached report for this exact content+intensity, or run a fresh pass.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content changes are captured via the hash inside the effect, not as a dep
  useEffect(() => {
    let cancelled = false;
    const key = `${hashDraftContent(draft)}:${intensity}`;
    const hit = getCached<HumanizeReport>("humanize", draft.id, key);
    if (hit) {
      setReport(hit.data);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    analyzeHumanize(draft.id, intensity)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setCached("humanize", draft.id, key, r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft, intensity]);

  const selectIntensity = useCallback(
    (next: Intensity): void => {
      localStorage.setItem(intensityKey(draft.id), next);
      setIntensity(next);
    },
    [draft.id],
  );

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      className="fixed right-0 top-0 z-30 h-full w-[420px] max-w-full overflow-y-auto glass-card border-l border-rule shadow-glass-lg animate-slide-in-right"
      aria-label="Humanize"
    >
      <header className="px-6 pt-6 pb-4 border-b border-rule glass-bar sticky top-0 z-10">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
            Humanize
          </p>
          <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
            <Icon name="x" size={16} title="" />
          </button>
        </div>

        <div className="mt-1 flex items-center gap-2.5">
          <img src="/humanize/mark.png" width={44} height={44} alt="humanize" />
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">Sound human</h2>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1.5" role="group" aria-label="Intensity">
          {INTENSITIES.map((opt) => {
            const active = intensity === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => selectIntensity(opt.value)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1 rounded-nb-sm px-2 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-cobalt-50 text-cobalt-700 ring-1 ring-cobalt-300"
                    : "text-muted hover:text-ink hover:bg-card-2"
                }`}
              >
                <img
                  src={opt.icon}
                  alt={opt.label}
                  width={28}
                  height={28}
                  style={{ mixBlendMode: "multiply" }}
                />
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <HumannessPulse antiRobot={88 /* TODO wire lint sub-score in Phase F */} humanSignal={report ? report.score : null} />
        </div>
      </header>

      {error && (
        <div
          className="mx-6 mt-6 px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          {error}
        </div>
      )}

      {!error && (
        <div className="p-6">
          {loading && !report ? (
            <p className="py-10 text-center text-sm text-muted">Reading for robotic tells…</p>
          ) : report ? (
            <>
              {/* Which lenses this pass covers, so a clean lens still shows it was
                  checked — HumanizeReviewRail only renders lenses with open findings. */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {report.lenses.map((lens) => (
                  <span
                    key={lens.key}
                    className="text-[11px] font-medium text-muted rounded-full border border-rule px-2 py-0.5"
                  >
                    {lens.label}
                  </span>
                ))}
              </div>
              <HumanizeReviewRail
                report={report}
                draft={draft}
                onSectionSave={onSectionSave}
                onHighlight={() => {}}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
