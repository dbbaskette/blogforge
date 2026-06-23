import { Link } from "react-router-dom";

export interface OnboardingStep {
  /** Stable key for list rendering. */
  key: string;
  /** Short imperative label, e.g. "Set up Your Voice". */
  label: string;
  /** Route the call-to-action links to. */
  to: string;
  /** Whether this step is already satisfied. */
  done: boolean;
}

/**
 * First-run onboarding checklist shown above the drafts list. Guides a brand-new
 * user toward the setup they need: a provider key/Tanzu, their voice, and a first
 * draft. The parent decides whether to render this (only when at least one step is
 * incomplete and the user hasn't dismissed it).
 */
export function OnboardingChecklist({
  steps,
  onDismiss,
}: {
  steps: OnboardingStep[];
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div className="nb-card mt-6 p-5 relative">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="nb-icon-btn absolute top-3 right-3 hover:!text-ink"
        title="Dismiss"
      >
        <span aria-hidden>✕</span>
      </button>

      <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-1">
        Get started
      </p>
      <h3 className="font-serif text-xl font-medium text-ink tracking-tight mb-1">
        A few steps to your first piece
      </h3>
      <p className="text-sm text-muted leading-relaxed mb-4 max-w-xl">
        Set these up once and BlogForge can write long-form drafts in your voice.
      </p>

      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-3">
            <span
              aria-hidden
              className={`grid place-items-center w-6 h-6 rounded-full text-sm font-medium shrink-0 ${
                step.done
                  ? "bg-cobalt-50 text-cobalt-600"
                  : "border border-rule text-muted bg-card"
              }`}
            >
              {step.done ? "✓" : i + 1}
            </span>
            {step.done ? (
              <span className="text-sm text-muted line-through">{step.label}</span>
            ) : (
              <Link
                to={step.to}
                className="text-sm font-medium text-cobalt-600 underline underline-offset-2 hover:text-cobalt-700 transition-colors"
              >
                {step.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
