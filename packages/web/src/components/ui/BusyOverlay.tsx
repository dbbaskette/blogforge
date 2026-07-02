import { useElapsed } from "../../hooks/useElapsed";

/**
 * A blocking modal shown while a slow AI action runs, so the writer knows to
 * wait instead of clicking again. Single LLM calls don't stream, so "progress"
 * is a live elapsed-seconds counter next to a spinner; the caller unmounts this
 * when the work finishes.
 */
export function BusyOverlay({ label }: { label: string }): JSX.Element {
  const secs = useElapsed(true);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label={label}
    >
      <div className="nb-card shadow-nb-pop px-6 py-5 flex items-center gap-3 max-w-sm animate-fade-up">
        <span
          aria-hidden="true"
          className="inline-block h-5 w-5 shrink-0 rounded-full border-2 border-cobalt-500 border-t-transparent animate-spin"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="text-xs text-muted tabular-nums">
            {secs}s · working{secs >= 12 ? " — larger drafts take longer" : "…"}
          </p>
        </div>
      </div>
    </div>
  );
}
