import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDialogA11y } from "../../src/components/ui/useDialogA11y";

function Dialog({ onClose }: { onClose: () => void }): JSX.Element {
  const ref = useDialogA11y(true, onClose);
  return (
    <div ref={ref}>
      <button type="button">first</button>
      <button type="button">second</button>
    </div>
  );
}

// A dialog (onCloseA) with a second dialog mounted over it (onCloseB) — the
// real shape of the compare modal opening inside a review panel.
function NestedDialogs({
  onCloseA,
  onCloseB,
}: {
  onCloseA: () => void;
  onCloseB: () => void;
}): JSX.Element {
  const refA = useDialogA11y(true, onCloseA);
  const refB = useDialogA11y(true, onCloseB);
  return (
    <>
      <div ref={refA}>
        <button type="button">parent</button>
      </div>
      <div ref={refB}>
        <button type="button">child</button>
      </div>
    </>
  );
}

describe("useDialogA11y", () => {
  it("moves focus into the dialog and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);

    await waitFor(() => expect((document.activeElement as HTMLElement)?.textContent).toBe("first"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with two dialogs open, Escape closes only the topmost", async () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    render(<NestedDialogs onCloseA={onCloseA} onCloseB={onCloseB} />);

    // Focus lands inside the topmost (second-mounted) dialog once effects run.
    await waitFor(() => expect((document.activeElement as HTMLElement)?.textContent).toBe("child"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
  });
});
