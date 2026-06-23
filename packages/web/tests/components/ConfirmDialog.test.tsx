import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfirmProvider, useConfirm } from "../../src/components/ui/ConfirmDialog";

function Harness({ onResult }: { onResult: (ok: boolean) => void }): JSX.Element {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => onResult(await confirm({ title: "Delete it?", danger: true }))}
    >
      go
    </button>
  );
}

describe("ConfirmProvider / useConfirm", () => {
  it("resolves true when confirmed and false when cancelled", async () => {
    const results: boolean[] = [];
    render(
      <ConfirmProvider>
        <Harness onResult={(ok) => results.push(ok)} />
      </ConfirmProvider>,
    );

    // Confirm path
    fireEvent.click(screen.getByText("go"));
    await screen.findByRole("dialog", { name: "Delete it?" });
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(results).toEqual([true]));
    // dialog closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Cancel path
    fireEvent.click(screen.getByText("go"));
    await screen.findByRole("dialog", { name: "Delete it?" });
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(results).toEqual([true, false]));
  });
});
