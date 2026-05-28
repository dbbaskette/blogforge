import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReferencesList } from "../../src/components/draft/ReferencesList";

vi.mock("../../src/api/references", () => ({
  listReferences: vi.fn(),
  deleteReference: vi.fn(),
  addUrlReference: vi.fn(),
  addTextReference: vi.fn(),
  addFileReference: vi.fn(),
}));

const sample = [
  {
    id: "r1",
    kind: "url" as const,
    name: "Anthropic blog",
    url: "https://anthropic.com",
    original_filename: null,
    extracted_chars: 4321,
    added_at: "2026-05-28T00:00:00Z",
  },
  {
    id: "r2",
    kind: "text" as const,
    name: "Notes",
    url: null,
    original_filename: null,
    extracted_chars: 540,
    added_at: "2026-05-28T00:00:01Z",
  },
];

describe("ReferencesList", () => {
  it("renders fetched references", async () => {
    const refs = await import("../../src/api/references");
    (refs.listReferences as ReturnType<typeof vi.fn>).mockResolvedValue(sample);

    render(<ReferencesList draftId="d1" />);

    await waitFor(() => expect(screen.getByText("Anthropic blog")).toBeInTheDocument());
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText(/4\.3k chars/i)).toBeInTheDocument();
    expect(screen.getByText(/540 chars/i)).toBeInTheDocument();
  });

  it("invokes deleteReference when × is clicked", async () => {
    const refs = await import("../../src/api/references");
    (refs.listReferences as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(sample)
      .mockResolvedValueOnce([sample[1]]);
    (refs.deleteReference as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<ReferencesList draftId="d1" />);

    await waitFor(() => expect(screen.getByText("Anthropic blog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Remove reference Anthropic blog/i }));
    await waitFor(() => expect(refs.deleteReference).toHaveBeenCalledWith("d1", "r1"));
  });

  it("renders empty state when there are no references", async () => {
    const refs = await import("../../src/api/references");
    (refs.listReferences as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<ReferencesList draftId="d1" />);

    await waitFor(() => expect(screen.getByText(/No references yet/i)).toBeInTheDocument());
  });

  it("submits a URL through AddReferenceForm and appends it to the list", async () => {
    const refs = await import("../../src/api/references");
    (refs.listReferences as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (refs.addUrlReference as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r9",
      kind: "url",
      name: "New URL",
      url: "https://example.com",
      original_filename: null,
      extracted_chars: 100,
      added_at: "2026-05-28T00:00:02Z",
    });

    render(<ReferencesList draftId="d1" />);

    await waitFor(() => expect(screen.getByText(/No references yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Reference URL/i), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add reference/i }));

    await waitFor(() =>
      expect(refs.addUrlReference).toHaveBeenCalledWith("d1", "https://example.com", undefined),
    );
    await waitFor(() => expect(screen.getByText("New URL")).toBeInTheDocument());
  });

  it("submits a text snippet through the Text tab", async () => {
    const refs = await import("../../src/api/references");
    (refs.listReferences as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (refs.addTextReference as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r10",
      kind: "text",
      name: "Snippet",
      url: null,
      original_filename: null,
      extracted_chars: 50,
      added_at: "2026-05-28T00:00:03Z",
    });

    render(<ReferencesList draftId="d1" />);

    await waitFor(() => expect(screen.getByText(/No references yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: /^Text$/ }));
    fireEvent.change(screen.getByLabelText(/Text name/i), { target: { value: "Snippet" } });
    fireEvent.change(screen.getByLabelText(/Text content/i), { target: { value: "hello world" } });
    fireEvent.click(screen.getByRole("button", { name: /Add reference/i }));

    await waitFor(() =>
      expect(refs.addTextReference).toHaveBeenCalledWith("d1", "Snippet", "hello world"),
    );
  });

  it("renders as a collapsible card when collapsible=true", async () => {
    const refs = await import("../../src/api/references");
    (refs.listReferences as ReturnType<typeof vi.fn>).mockResolvedValue(sample);

    render(<ReferencesList draftId="d1" collapsible defaultOpen={false} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /References/i })).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
    expect(screen.queryByText("Anthropic blog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /References/i }));
    await waitFor(() => expect(screen.getByText("Anthropic blog")).toBeInTheDocument());
  });
});
