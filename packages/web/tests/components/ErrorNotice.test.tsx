import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiError } from "../../src/api/client";
import { ErrorNotice } from "../../src/components/ui/ErrorNotice";

function apiError(status: number, detail: unknown, code?: string): ApiError {
  return Object.assign(new Error("The request could not be completed."), { status, code, detail });
}

describe("ErrorNotice", () => {
  it("offers retry and keeps technical metadata behind Details", () => {
    const onRetry = vi.fn();
    render(
      <ErrorNotice
        error={apiError(422, [{ loc: ["body", "title"], msg: "Field required" }])}
        operation="saving your draft"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Check the information");
    expect(screen.getByText("Details").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Details"));
    expect(screen.getByText(/Field required/)).toBeInTheDocument();
  });

  it("uses the supplied recovery callback and can be dismissed", () => {
    const onOpenSettings = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ErrorNotice
        error={apiError(502, { code: "provider_missing_key" }, "provider_missing_key")}
        operation="creating an outline"
        onOpenSettings={onOpenSettings}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("offers Reload for a conflict even when no callback is supplied", () => {
    render(
      <ErrorNotice
        error={apiError(409, { code: "publish_conflict" }, "publish_conflict")}
        operation="publishing your draft"
      />,
    );

    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
