import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessibility wiring shared by every overlay (confirm dialog, side panels):
 * when `active`, it moves focus into the container, traps Tab within it,
 * closes on Escape, and restores focus to the previously-focused element on
 * close. Returns a ref to spread onto the dialog/panel root element.
 */
export function useDialogA11y(
  active: boolean,
  onClose: () => void,
): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

    // Defer the initial focus so the element is mounted/painted.
    const raf = requestAnimationFrame(() => (focusables()[0] ?? node)?.focus());

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && node) {
        const f = focusables();
        if (f.length === 0) {
          e.preventDefault();
          return;
        }
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [active]);

  return ref;
}
