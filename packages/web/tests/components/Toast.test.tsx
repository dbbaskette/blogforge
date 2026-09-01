import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "../../src/components/ui/Toast";

function Probe({ kind }: { kind: "success" | "error" }): JSX.Element {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(kind === "error" ? "boom" : "done", kind)}>
      fire
    </button>
  );
}

function UndoProbe({ onAction }: { onAction: () => void }): JSX.Element {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast("Moved to trash", "success", { action: { label: "Undo", onClick: onAction } })
      }
    >
      fire
    </button>
  );
}

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("auto-dismisses success toasts", () => {
    render(
      <ToastProvider>
        <Probe kind="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    expect(screen.getByText("done")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3600);
    });
    expect(screen.queryByText("done")).not.toBeInTheDocument();
  });

  it("keeps error toasts until dismissed", () => {
    render(
      <ToastProvider>
        <Probe kind="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // Well past the success auto-dismiss window — the error is still shown.
    expect(screen.getByText("boom")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/dismiss notification: boom/i));
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("runs a toast action button and dismisses the toast", () => {
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <UndoProbe onAction={onAction} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    const action = screen.getByRole("button", { name: "Undo" });
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    // The action fired and the toast went away with it.
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
