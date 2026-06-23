import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastKind = "success" | "error";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

/** Show a transient, auto-dismissing notification. */
export type ToastFn = (message: string, kind?: ToastKind) => void;

// Default is a no-op so any consumer stays usable (and unit-testable) without
// the provider; the <ToastProvider> mounted at the app root overrides it with
// the on-brand toast stack in the running app. Mirrors ConfirmDialog's pattern.
const ToastContext = createContext<ToastFn>(() => {});

const AUTO_DISMISS_MS = 3500;

/**
 * App-level provider exposing `useToast()` — fire-and-forget success/error
 * notifications. Renders a fixed bottom-right stack that auto-dismisses.
 */
export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (message, kind = "success") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, kind }]);
      setTimeout(() => remove(id), AUTO_DISMISS_MS);
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
    </button>
  );
}
