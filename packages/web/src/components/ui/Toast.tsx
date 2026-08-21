import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastKind = "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

/** Show a notification: successes auto-dismiss; errors persist until clicked. */
export type ToastFn = (message: string, kind?: ToastKind, opts?: { action?: ToastAction }) => void;

// Default is a no-op so any consumer stays usable (and unit-testable) without
// the provider; the <ToastProvider> mounted at the app root overrides it with
// the on-brand toast stack in the running app. Mirrors ConfirmDialog's pattern.
const ToastContext = createContext<ToastFn>(() => {});

const AUTO_DISMISS_MS = 3500;

/**
 * App-level provider exposing `useToast()` — fire-and-forget success/error
 * notifications. Renders a fixed bottom-right stack; successes auto-dismiss,
 * errors stay until clicked.
 */
export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    // biome-ignore lint/style/useDefaultParameterLast: kind mirrors the original two-arg signature callers already use.
    (message, kind = "success", opts) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, kind, action: opts?.action }]);
      // Successes auto-dismiss; errors stay until clicked so they can't
      // silently vanish before the user has read them.
      if (kind !== "error") {
        setTimeout(() => remove(id), AUTO_DISMISS_MS);
      }
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2 pointer-events-none"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): { toast: ToastFn } {
  return { toast: useContext(ToastContext) };
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }): JSX.Element {
  const success = toast.kind === "success";
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="nb-card pointer-events-auto flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-left animate-slide-in-right max-w-sm"
      style={
        success
          ? { background: "#e3f5ec", borderColor: "#15a06b", color: "#0e7a50" }
          : { background: "#fde7e2", borderColor: "#e6492d", color: "#b5321b" }
      }
      aria-label={`Dismiss notification: ${toast.message}`}
    >
      <span aria-hidden="true" className="text-base leading-none">
        {success ? "✓" : "✕"}
      </span>
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toast.action?.onClick();
            onDismiss();
          }}
          className="ml-1 font-bold underline underline-offset-2 hover:no-underline"
        >
          {toast.action.label}
        </button>
      )}
    </button>
  );
}
