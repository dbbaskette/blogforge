import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([{ slug: "house", valid: true }]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
  listFormats: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: true, openai: false }),
  listModels: vi.fn().mockResolvedValue([]),
}));

import type { Draft } from "../../../src/api/drafts";
import { SetupDisclosure } from "../../../src/components/draft/SetupDisclosure";

const draft: Draft = {
  id: "draft-1",
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
  title: "Existing draft",
  stage: "research",
  idea: {
    topic: "Saved topic",
    pack_slug: "house",
    format: null,
    provider: "openai",
    model: "saved-model",
    target_words: 1500,
    use_voice_profile: true,
  },
  outline: null,
  sections: [],
  tags: [],
  hero_image_key: null,
};

describe("SetupDisclosure", () => {
  it("does not replace an existing draft's unavailable saved provider", async () => {
    const onChange = vi.fn();
    render(<SetupDisclosure draft={draft} onChange={onChange} forceOpen />);

    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("openai"));
    await waitFor(() => expect(screen.getByText(/No API key for openai/)).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes stable DOM targets that can reveal and focus Setup", async () => {
    render(<SetupDisclosure draft={draft} onChange={vi.fn()} />);

    const setup = document.getElementById("draft-setup");
    const toggle = document.getElementById("draft-setup-toggle");
    expect(setup).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle as HTMLElement);
    (toggle as HTMLElement).focus();

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    await waitFor(() => expect(screen.getByLabelText("Provider")).toHaveValue("openai"));
  });
});
