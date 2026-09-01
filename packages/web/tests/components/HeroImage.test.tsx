import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteHeroImage, generateHeroImage } from "../../src/api/drafts";
import { HeroImage } from "../../src/components/draft/HeroImage";

vi.mock("../../src/api/drafts", () => ({
  deleteHeroImage: vi.fn(),
  generateHeroImage: vi.fn(),
  heroImageUrl: (draftId: string, version: string) =>
    `/api/drafts/${draftId}/hero-image?v=${version}`,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateHeroImage).mockResolvedValue({ hero_image_key: "new-key" });
  vi.mocked(deleteHeroImage).mockResolvedValue(undefined);
});

describe("HeroImage", () => {
  it("offers themes and sends selected direction with generation", async () => {
    const onChanged = vi.fn();
    render(<HeroImage draftId="draft-1" heroKey={null} onChanged={onChanged} />);

    expect(screen.getByText(/uses specific facts from your article/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editorial" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Fun" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Space" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimal" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Space" }));
    fireEvent.change(screen.getByLabelText("Image direction"), {
      target: { value: "Retro-futurist cobalt and coral illustration" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate hero image" }));

    await waitFor(() =>
      expect(generateHeroImage).toHaveBeenCalledWith("draft-1", {
        theme: "space",
        direction: "Retro-futurist cobalt and coral illustration",
      }),
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("keeps image direction available when regenerating", async () => {
    render(<HeroImage draftId="draft-1" heroKey="hero-key" onChanged={vi.fn()} />);

    expect(screen.getByRole("img", { name: "Draft hero" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fun" }));
    fireEvent.change(screen.getByLabelText("Image direction"), {
      target: { value: "Paper cutout characters and bright geometric shapes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() =>
      expect(generateHeroImage).toHaveBeenCalledWith("draft-1", {
        theme: "fun",
        direction: "Paper cutout characters and bright geometric shapes",
      }),
    );
  });

  it("shows an actionable retry notice for a provider failure", async () => {
    const failure = Object.assign(new Error("upstream 502"), {
      status: 502,
      code: "image_generation_failed",
    });
    vi.mocked(generateHeroImage).mockRejectedValueOnce(failure).mockResolvedValueOnce({
      hero_image_key: "retry-key",
    });
    render(<HeroImage draftId="draft-1" heroKey={null} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate hero image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The service is unavailable");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(generateHeroImage).toHaveBeenCalledTimes(2));
  });
});
