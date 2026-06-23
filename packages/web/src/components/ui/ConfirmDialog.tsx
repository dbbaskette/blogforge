import { createContext, useCallback, useContext, useRef, useState } from "react";

import { useDialogA11y } from "./useDialogA11y";

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

type Resolver = (ok: boolean) => void;

// Default falls back to the native confirm so any consumer stays usable (and
// unit-testable) without the provider; the <ConfirmProvider> mounted at the app
// root overrides it with the on-brand modal in the running app.
const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(
  (opts) =>
    Promise.resolve(
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(typeof opts.title === "string" ? opts.title : "Are you sure?")
        : true,
    ),
);

/**
 * App-level provider exposing `useConfirm()` — an async, on-brand replacement
 * for the native `window.confirm()`. Renders a single focus-trapped modal.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((next: ConfirmOptions): Promise<boolean> => {
    setOpts(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean): void => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <ConfirmModal
          opts={opts}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  return useContext(ConfirmContext);
}

function ConfirmModal({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const ref = useDialogA11y(true, onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm animate-fade-in p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={ref}
        className="nb-card w-[440px] max-w-full p-0 text-ink animate-fade-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={opts.title}
      >
        <div className="px-7 pt-6 pb-5 space-y-2">
          <h2 className="font-serif text-xl font-medium text-ink tracking-tight">{opts.title}</h2>
          {opts.message && (
            <div className="text-sm text-ink-2 leading-relaxed">{opts.message}</div>
          )}
        </div>
        <div className="px-7 pb-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="nb-btn nb-btn-sm">
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`nb-btn nb-btn-sm ${opts.danger ? "nb-btn-danger" : "nb-btn-primary"}`}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
