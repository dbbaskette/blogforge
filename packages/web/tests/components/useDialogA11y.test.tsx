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

describe("useDialogA11y", () => {
  it("moves focus into the dialog and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);

    await waitFor(() =>
      expect((document.activeElement as HTMLElement)?.textContent).toBe("first"),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
