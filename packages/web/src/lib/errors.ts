import type { ApiError } from "../api/client";

export type ErrorRecoveryAction = "retry" | "settings" | "sign-in" | "reload";

export interface ErrorPresentation {
  title: string;
  explanation: string;
  preservation: string;
  action: ErrorRecoveryAction;
}

const PROVIDER_CODES = new Set([
  "empty_key",
  "invalid_key",
  "unknown_provider",
  "provider_missing_key",
  "provider_rejected_request",
]);

function apiErrorStatus(error: unknown): number | undefined {
  return typeof (error as Partial<ApiError>)?.status === "number"
    ? (error as Partial<ApiError>).status
    : undefined;
}

function apiErrorCode(error: unknown): string | undefined {
  return typeof (error as Partial<ApiError>)?.code === "string"
    ? (error as Partial<ApiError>).code
    : undefined;
}

function isProviderError(code: string | undefined): boolean {
  return Boolean(
    code && (PROVIDER_CODES.has(code) || code.startsWith("provider_") || code.includes("api_key")),
  );
}

/**
 * Turn an API failure into copy and a recovery action that is safe to show to writers.
 * The original error remains available to ErrorNotice's technical disclosure.
 */
export function presentError(error: unknown, operation: string): ErrorPresentation {
  const status = apiErrorStatus(error);
  const code = apiErrorCode(error);
  const preservation = "Your work is still here.";

  if (isProviderError(code)) {
    return {
      title: "Check your AI provider",
      explanation: `BlogForge could not use the configured AI provider for ${operation}.`,
      preservation,
      action: "settings",
    };
  }

  if (status === 422 || status === 400) {
    return {
      title: "Check the information",
      explanation: `Some information needs attention before ${operation}.`,
      preservation,
      action: "retry",
    };
  }

  if (status === 409 || code?.includes("conflict")) {
    return {
      title: "This changed somewhere else",
      explanation: `Reload the latest version before ${operation}.`,
      preservation,
      action: "reload",
    };
  }

  if (status === 401 || code?.includes("session") || code === "not_authenticated") {
    return {
      title: "Sign in again",
      explanation: `Your session ended before ${operation}.`,
      preservation,
      action: "sign-in",
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      title: "The service is unavailable",
      explanation: `BlogForge could not finish ${operation} right now. Please try again shortly.`,
      preservation,
      action: "retry",
    };
  }

  return {
    title: "Something went wrong",
    explanation: `BlogForge could not finish ${operation}. Please try again.`,
    preservation,
    action: "retry",
  };
}
