import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/api/voice", () => ({
  importLinkedIn: vi.fn().mockResolvedValue({
    id: "vp1",
    user_id: "u1",
    name: "Test Voice",
    persona_identity: "",
    persona_one_line: "",
    persona_tone: "",
    rules: { banished_words: [], banished_phrases: [], no_em_dashes: false, no_ascii_double_hyphen: false },
    distilled_style_md: "",
    distilled_at: null,
    version: 1,
    samples: [],
  }),
}));

import { LinkedInImportCard } from "../../../src/components/voice/LinkedInImportCard";

describe("LinkedInImportCard", () => {
  it("renders the heading 'Import from LinkedIn'", () => {
    render(<LinkedInImportCard onImported={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /import from linkedin/i })).toBeInTheDocument();
  });

  it("renders a file input that accepts .zip", () => {
    render(<LinkedInImportCard onImported={vi.fn()} />);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    expect(fileInput?.accept).toBe(".zip");
  });

  it("renders the LinkedIn data export link", () => {
    render(<LinkedInImportCard onImported={vi.fn()} />);
    const link = screen.getByRole("link", { name: /open linkedin data export/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://www.linkedin.com/mypreferences/d/download-my-data");
  });
});
