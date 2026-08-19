import { useEffect, useRef, useState } from "react";

import type { DraftNextAction as DraftNextActionModel } from "../../lib/draftNextAction";
import { ErrorNotice } from "../ui/ErrorNotice";

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
  const inFlight = useRef(false);
  const requestSequence = useRef(0);
  const currentKind = useRef(action.kind);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{
    kind: DraftNextActionModel["kind"];
    error: unknown;
  } | null>(null);
  const error = failure?.kind === action.kind ? failure.error : null;

  if (currentKind.current !== action.kind) {
    currentKind.current = action.kind;
    requestSequence.current += 1;
    inFlight.current = false;
  }

  useEffect(() => {
    setFailure((current) => (current?.kind === action.kind ? current : null));
    setPending(false);
  }, [action.kind]);

  const callbacks = {
    "create-outline": onCreateOutline,
    "compose-draft": onComposeDraft,
    "retry-remaining": onRetryRemaining,
    "finish-remaining": onFinishRemaining,
    "review-outline": onReviewOutline,
    "review-draft": onReviewDraft,
  };

  const runAction = async (): Promise<void> => {
    if (action.disabled || inFlight.current) return;
    const callback = callbacks[action.kind];
    if (!callback) return;
    const request = ++requestSequence.current;
    const kind = action.kind;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      await callback();
    } catch (nextError) {
      if (request === requestSequence.current && kind === currentKind.current) {
        setFailure({ kind, error: nextError });
      }
    } finally {
      if (request === requestSequence.current && kind === currentKind.current) {
        inFlight.current = false;
        setPending(false);
      }
    }
  };

  const operation =
    action.kind === "create-outline"
      ? "creating an outline"
      : action.kind === "review-outline"
        ? "opening the outline"
        : action.kind === "review-draft"
          ? "opening Review Center"
          : action.kind === "retry-remaining"
            ? "retrying the remaining sections"
            : action.kind === "finish-remaining"
              ? "finishing the remaining sections"
              : "composing the draft";

  return (
    <section
      aria-labelledby="next-draft-action-label"
      aria-busy={pending || undefined}
      className="mt-4 mb-6 border-l-[3px] border-cobalt-500 pl-4 py-1"
    >
      <div className="sm:flex sm:items-center sm:justify-between sm:gap-5">
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
        {error === null && (
          <button
            type="button"
            onClick={() => void runAction()}
            disabled={action.disabled || pending}
            className="nb-btn nb-btn-primary nb-btn-sm mt-3 sm:mt-0 shrink-0"
          >
            {pending ? "Working…" : action.label}
          </button>
        )}
      </div>
      {error !== null && (
        <div className="mt-3">
          <ErrorNotice
            error={error}
            operation={operation}
            onRetry={() => void runAction()}
            onDismiss={() => setFailure(null)}
          />
        </div>
      )}
    </section>
  );
}
