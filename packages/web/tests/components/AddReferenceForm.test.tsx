import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiError } from "../../src/api/client";
import { AddReferenceForm } from "../../src/components/draft/AddReferenceForm";

vi.mock("../../src/api/references", () => ({
  addUrlReference: vi.fn(),
  addTextReference: vi.fn(),
  addFileReference: vi.fn(),
}));

async function selectFile() {
  const references = await import("../../src/api/references");
  fireEvent.click(screen.getByRole("tab", { name: "File" }));
  fireEvent.change(screen.getByLabelText("Reference file"), {
    target: { files: [new File(["source"], "source.txt", { type: "text/plain" })] },
  });
  fireEvent.change(screen.getByLabelText("File friendly name"), {
    target: { value: "My source" },
  });
  return references;
}

function uploadError(status: number, code: string | undefined, detail: unknown): ApiError {
  return Object.assign(new Error("The request could not be completed."), {
    status,
    code,
    detail,
  });
}

describe("AddReferenceForm upload recovery", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows safe validation recovery and retries the selected upload", async () => {
    const references = await selectFileAfterRender();
    vi.mocked(references.addFileReference)
      .mockRejectedValueOnce(uploadError(422, "reference_file_too_large", { max_bytes: 5_000_000 }))
      .mockResolvedValueOnce({
        id: "r1",
        kind: "file",
        name: "My source",
        url: null,
        original_filename: "source.txt",
        extracted_chars: 6,
        added_at: "2026-08-17T12:00:00Z",
      });

    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Check the information");
    expect(screen.getByText("Details").closest("details")).toHaveTextContent("max_bytes");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(references.addFileReference).toHaveBeenCalledTimes(2));
    expect(references.addFileReference).toHaveBeenLastCalledWith(
      "d1",
      expect.objectContaining({ name: "source.txt" }),
      "My source",
    );
  });

  it("offers sign-in recovery for an expired upload session", async () => {
    const references = await selectFileAfterRender();
    vi.mocked(references.addFileReference).mockRejectedValue(
      uploadError(401, "session_revoked", "session_revoked"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("keeps plain response text in details and supports dismissing it", async () => {
    const references = await selectFileAfterRender();
    vi.mocked(references.addFileReference).mockRejectedValue(
      uploadError(503, undefined, "storage temporarily offline"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The service is unavailable");
    expect(screen.getByText("The service is unavailable")).not.toHaveTextContent(
      /storage temporarily offline/i,
    );
    expect(screen.getByText("Details").closest("details")).toHaveTextContent(
      "storage temporarily offline",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

async function selectFileAfterRender() {
  render(<AddReferenceForm draftId="d1" onAdded={vi.fn()} />);
  return selectFile();
}
