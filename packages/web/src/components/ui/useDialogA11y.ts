import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The stack of currently-open dialogs, in mount order (last = topmost). Every
 * useDialogA11y instance pushes its id while open and pops it on close, so a
 * document-level Escape/Tab handler can tell whether IT owns the keystroke.
 * Dialogs nest (a compare modal opens over a review panel, both driven by this
 * hook), and both listen on `document`; without this only the topmost should
 * react, or one Escape closes the whole stack.
 */
const dialogStack: symbol[] = [];

/**
 * Accessibility wiring shared by every overlay (confirm dialog, side panels):
 * when `active`, it moves focus into the container, traps Tab within it,
 * closes on Escape, and restores focus to the previously-focused element on
 * close. Returns a ref to spread onto the dialog/panel root element.
 */
export function useDialogA11y(active: boolean, onClose: () => void): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Stable identity for this dialog instance across renders.
  const id = useRef<symbol>(Symbol("dialog")).current;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;

    // Register as the topmost open dialog for the lifetime of this effect.
    dialogStack.push(id);
    const isTopmost = (): boolean => dialogStack[dialogStack.length - 1] === id;

    const focusables = (): HTMLElement[] =>
      node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

    // Defer the initial focus so the element is mounted/painted.
    const raf = requestAnimationFrame(() => (focusables()[0] ?? node)?.focus());

    const onKey = (e: KeyboardEvent): void => {
      // Only the topmost dialog owns keyboard handling — a dialog buried under
      // a modal must not close on Escape or fight over the focus trap.
      if (!isTopmost()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        // Stop other document listeners (e.g. an ancestor dialog) from also
        // reacting to this same Escape.
        e.stopImmediatePropagation();
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
      const idx = dialogStack.lastIndexOf(id);
      if (idx !== -1) dialogStack.splice(idx, 1);
      prevFocus?.focus?.();
    };
  }, [active, id]);

  return ref;
}
