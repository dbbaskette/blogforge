import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([{ slug: "house", valid: true }]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
}));
vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: true }),
  listModels: vi.fn().mockResolvedValue([{ id: "m1", label: "Model One" }]),
}));

import { type ComposeSettings, SetupFields } from "../../src/components/SetupFields";

const base: ComposeSettings = {
  pack_slug: "house",
  format: null,
  provider: "anthropic",
  model: "m1",
  target_words: 1500,
  use_voice_profile: true,
};

describe("SetupFields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the model and emits target_words changes", async () => {
    const onChange = vi.fn();
    render(<SetupFields value={base} onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(/Model One/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Target length/i), { target: { value: "2000" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target_words: 2000 }));
  });

  it("emits use_voice_profile=false when 'A voice pack' is chosen", async () => {
    const onChange = vi.fn();
    render(<SetupFields value={base} onChange={onChange} />);
    await waitFor(() => {});
    fireEvent.click(screen.getByRole("button", { name: /a voice pack/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ use_voice_profile: false }));
  });
});
