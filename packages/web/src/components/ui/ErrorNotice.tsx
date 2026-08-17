import type { ApiError } from "../../api/client";
import { type ErrorRecoveryAction, presentError } from "../../lib/errors";

export interface ErrorNoticeProps {
  error: unknown;
  operation: string;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onSignIn?: () => void;
  onReload?: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
}

const ACTION_LABELS: Record<ErrorRecoveryAction, string> = {
  retry: "Retry",
  settings: "Open Settings",
  "sign-in": "Sign in",
  reload: "Reload",
};

function technicalDetails(error: unknown): string {
  const apiError = error as Partial<ApiError>;
  const data = {
    message: error instanceof Error ? error.message : String(error),
    status: apiError.status,
    code: apiError.code,
    detail: apiError.detail,
  };
  return JSON.stringify(data, null, 2);
}

export function ErrorNotice({
  error,
  operation,
  onRetry,
  onOpenSettings,
  onSignIn,
  onReload,
  onDismiss,
  dismissLabel = "Dismiss",
}: ErrorNoticeProps): JSX.Element {
  const presentation = presentError(error, operation);
  const action = presentation.action;

  function runAction(): void {
    if (action === "retry") {
      onRetry?.();
    } else if (action === "settings") {
      onOpenSettings?.();
    } else if (action === "sign-in") {
      onSignIn?.();
    } else if (onReload) {
      onReload();
    } else if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  const needsFallbackLink =
    (action === "settings" && !onOpenSettings) || (action === "sign-in" && !onSignIn);
  const shouldRenderButton =
    (action === "retry" && Boolean(onRetry)) ||
    (action === "settings" && Boolean(onOpenSettings)) ||
    (action === "sign-in" && Boolean(onSignIn)) ||
    action === "reload";
  const fallbackHref = action === "settings" ? "/settings" : "/login";

  return (
    <div
      role="alert"
      className="rounded-nb-sm border px-3 py-3 text-sm space-y-2"
      style={{ background: "#fde7e2", borderColor: "#f7c3b6", color: "#b5321b" }}
    >
      <div className="space-y-1">
        <p className="font-semibold text-ink">{presentation.title}</p>
        <p className="text-ink-2">{presentation.explanation}</p>
        <p className="text-ink-2">{presentation.preservation}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {shouldRenderButton && (
          <button type="button" onClick={runAction} className="nb-btn nb-btn-primary nb-btn-sm">
            {ACTION_LABELS[action]}
          </button>
        )}
        {needsFallbackLink && (
          <a href={fallbackHref} className="nb-btn nb-btn-primary nb-btn-sm">
            {ACTION_LABELS[action]}
          </a>
        )}
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="nb-btn nb-btn-ghost nb-btn-sm">
            {dismissLabel}
          </button>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-ink-2">
          Details
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-paper-2 p-2 text-xs text-ink-2">
          {technicalDetails(error)}
        </pre>
      </details>
    </div>
  );
}
