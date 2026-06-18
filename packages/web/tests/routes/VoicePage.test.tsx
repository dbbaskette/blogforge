import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { VoicePage } from "../../src/routes/VoicePage";

// Build mock profile as a plain object literal (no top-level const) so that
// vi.mock hoisting doesn't cause a TDZ error.
vi.mock("../../src/api/voice", () => {
  const profile = {
    id: "vp1",
    user_id: "u1",
    name: "Test Voice",
    persona_identity: "A technical writer who simplifies complexity",
    persona_one_line: "Making complex things simple",
    persona_tone: "Clear, direct, and approachable",
    rules: {
      banished_words: ["very", "really"],
      banished_phrases: ["in order to"],
      no_em_dashes: false,
      no_ascii_double_hyphen: true,
    },
    distilled_style_md: "Write with clarity and precision.",
    distilled_at: "2026-01-15T10:00:00Z",
    version: 3,
    samples: [
      {
        id: "s1",
        kind: "text",
        name: "My Blog Intro",
        source_url: null,
        original_filename: null,
        s3_key: "samples/s1",
        extracted_chars: 1200,
        exemplar: true,
        status: "ready",
        added_at: "2026-01-10T09:00:00Z",
      },
    ],
  };
  return {
    getVoiceProfile: vi.fn().mockResolvedValue(profile),
    updatePersona: vi.fn().mockResolvedValue(profile),
    updateRules: vi.fn().mockResolvedValue(profile),
    updateDistilled: vi.fn().mockResolvedValue(profile),
    addTextSample: vi.fn().mockResolvedValue(profile.samples[0]),
    addUrlSample: vi.fn().mockResolvedValue(profile.samples[0]),
    uploadSampleFile: vi.fn().mockResolvedValue(profile.samples[0]),
    deleteSample: vi.fn().mockResolvedValue(undefined),
    setExemplar: vi.fn().mockResolvedValue(profile),
    distill: vi.fn().mockResolvedValue(profile),
    voiceExportUrl: vi.fn().mockReturnValue("/api/voice/export"),
    listSources: vi.fn().mockResolvedValue([]),
    addUrlSource: vi.fn().mockResolvedValue({ id: "src1", url: "https://example.com", name: "Example", status: "ready", extracted_chars: 0, added_at: "2026-01-01T00:00:00Z" }),
    deleteSource: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: { id: "u1", email: "test@x.com", role: "user", status: "approved" },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

function renderPage(): void {
  render(
    <MemoryRouter>
      <VoicePage />
    </MemoryRouter>,
  );
}

describe("VoicePage", () => {
  it("renders the page heading and persona identity once loaded", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /your voice/i })).toBeInTheDocument(),
    );
    expect(
      screen.getByDisplayValue("A technical writer who simplifies complexity"),
    ).toBeInTheDocument();
  });

  it("shows the sample name in the samples list", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("My Blog Intro")).toBeInTheDocument());
  });

  it("calls setExemplar when the star button is clicked", async () => {
    const { setExemplar } = await import("../../src/api/voice");
    renderPage();
    await waitFor(() => expect(screen.getByText("My Blog Intro")).toBeInTheDocument());

    // The star button — it toggles exemplar (currently true → false)
    const starBtn = screen.getByRole("button", { name: /exemplar/i });
    fireEvent.click(starBtn);

    await waitFor(() =>
      expect(setExemplar).toHaveBeenCalledWith("s1", false),
    );
  });

  it("shows download pack link", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /download pack/i })).toBeInTheDocument(),
    );
  });

  it("shows distilled style text in the textarea", async () => {
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Write with clarity and precision."),
      ).toBeInTheDocument(),
    );
  });
});
