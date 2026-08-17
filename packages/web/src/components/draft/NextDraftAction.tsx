import type { DraftNextAction as DraftNextActionModel } from "../../lib/draftNextAction";

interface NextDraftActionProps {
  action: DraftNextActionModel;
  onCreateOutline?: () => void | Promise<void>;
  onComposeDraft?: () => void | Promise<void>;
  onRetryRemaining?: () => void | Promise<void>;
  onFinishRemaining?: () => void | Promise<void>;
  onReviewOutline?: () => void | Promise<void>;
  onReviewDraft?: () => void | Promise<void>;
  onSetup?: () => void;
}

export function NextDraftAction({
  action,
  onCreateOutline,
  onComposeDraft,
  onRetryRemaining,
  onFinishRemaining,
  onReviewOutline,
  onReviewDraft,
  onSetup,
}: NextDraftActionProps): JSX.Element {
  const callbacks = {
    "create-outline": onCreateOutline,
    "compose-draft": onComposeDraft,
    "retry-remaining": onRetryRemaining,
    "finish-remaining": onFinishRemaining,
    "review-outline": onReviewOutline,
    "review-draft": onReviewDraft,
  };

  return (
    <section
      aria-labelledby="next-draft-action-label"
      className="mt-4 mb-6 border-l-[3px] border-cobalt-500 pl-4 py-1 sm:flex sm:items-center sm:justify-between sm:gap-5"
    >
      <div className="min-w-0">
        <p
          id="next-draft-action-label"
          className="font-mono text-[10px] font-semibold tracking-[0.18em] text-cobalt-600"
        >
          NEXT
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">
          {action.copy}{" "}
          {action.blocker === "setup" && (
            // biome-ignore lint/a11y/useValidAnchor: this navigates to and reveals the in-page Setup section
            <a
              href="#draft-setup"
              onClick={onSetup}
              className="font-medium text-cobalt-700 underline underline-offset-2 hover:no-underline"
            >
              Open Setup
            </a>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void callbacks[action.kind]?.()}
        disabled={action.disabled}
        className="nb-btn nb-btn-primary nb-btn-sm mt-3 sm:mt-0 shrink-0"
      >
        {action.label}
      </button>
    </section>
  );
}
