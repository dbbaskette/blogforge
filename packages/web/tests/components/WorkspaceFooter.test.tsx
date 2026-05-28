import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceFooter } from "../../src/components/draft/WorkspaceFooter";

vi.mock("../../src/api/linkedin", () => ({
  publishToLinkedIn: vi.fn(),
  getLinkedInStats: vi.fn(),
}));

const baseProps = {
  draftId: "d1",
  totalWords: 120,
  draftedCount: 2,
  sectionCount: 2,
  onLint: vi.fn(),
  postText: "This is the assembled post body.",
  teaserText: "This is the first section.",
  stage: "sections" as const,
};

beforeEach(() => {
  // jsdom lacks clipboard; stub it so the Copy button doesn't blow up.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceFooter — existing buttons", () => {
  it("keeps Copy, Download and Lint working", () => {
    render(<WorkspaceFooter {...baseProps} />);
    expect(screen.getByRole("button", { name: /copy markdown/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download \.md/i })).toBeInTheDocument();
    const lintBtn = screen.getByRole("button", { name: /^lint$/i });
    fireEvent.click(lintBtn);
    expect(baseProps.onLint).toHaveBeenCalled();
  });
});

describe("WorkspaceFooter — Post to LinkedIn", () => {
  it("does not render the Post button outside the sections stage", () => {
    render(<WorkspaceFooter {...baseProps} stage="outline" />);
    expect(screen.queryByRole("button", { name: /post to linkedin/i })).not.toBeInTheDocument();
  });

  it("opens a composer with a live char meter and publishes", async () => {
    const li = await import("../../src/api/linkedin");
    (li.publishToLinkedIn as ReturnType<typeof vi.fn>).mockResolvedValue({
      post_urn: "urn:li:share:1",
      post_id: "p1",
    });

    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /post to linkedin/i }));

    // Char meter reflects code-point length of the post text.
    expect(screen.getByText(/\/3000/)).toHaveTextContent(`${[...baseProps.postText].length}/3000`);

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    await waitFor(() =>
      expect(li.publishToLinkedIn).toHaveBeenCalledWith(
        expect.objectContaining({ text: baseProps.postText, draft_id: "d1" }),
      ),
    );
    // Posted chip appears.
    await waitFor(() => expect(screen.getByText(/posted to linkedin/i)).toBeInTheDocument());
  });

  it("disables Publish when over 3000 chars and offers a teaser escape hatch", async () => {
    const li = await import("../../src/api/linkedin");
    (li.publishToLinkedIn as ReturnType<typeof vi.fn>).mockResolvedValue({
      post_urn: "urn:li:share:2",
      post_id: "p2",
    });
    const longText = "x".repeat(3500);
    const teaser = "Opening teaser section.";

    render(<WorkspaceFooter {...baseProps} postText={longText} teaserText={teaser} />);
    fireEvent.click(screen.getByRole("button", { name: /post to linkedin/i }));

    const publishBtn = screen.getByRole("button", { name: /^publish$/i });
    expect(publishBtn).toBeDisabled();
    // 500 over the limit is surfaced.
    expect(screen.getByText(/500 over/i)).toBeInTheDocument();

    // Teaser escape hatch trims to the first section and re-enables publish.
    fireEvent.click(screen.getByRole("button", { name: /opening as teaser/i }));
    expect(screen.getByRole("button", { name: /^publish$/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    await waitFor(() =>
      expect(li.publishToLinkedIn).toHaveBeenCalledWith(
        expect.objectContaining({ text: teaser, draft_id: "d1" }),
      ),
    );
  });

  it("maps a not_connected error to a friendly message", async () => {
    const li = await import("../../src/api/linkedin");
    (li.publishToLinkedIn as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("HTTP 401: not_connected"), { status: 401, code: "not_connected" }),
    );

    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /post to linkedin/i }));
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() =>
      expect(screen.getByText(/connect.*linkedin.*settings/i)).toBeInTheDocument(),
    );
  });

  it("refreshes stats from the posted chip", async () => {
    const li = await import("../../src/api/linkedin");
    (li.publishToLinkedIn as ReturnType<typeof vi.fn>).mockResolvedValue({
      post_urn: "urn:li:share:3",
      post_id: "p3",
    });
    (li.getLinkedInStats as ReturnType<typeof vi.fn>).mockResolvedValue({
      likes: 5,
      comments: 2,
      fetched_at: "2026-05-28T00:00:00Z",
    });

    render(<WorkspaceFooter {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /post to linkedin/i }));
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    await waitFor(() => expect(screen.getByText(/posted to linkedin/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(li.getLinkedInStats).toHaveBeenCalledWith("p3"));
    await waitFor(() => expect(screen.getByText(/5/)).toBeInTheDocument());
  });
});
