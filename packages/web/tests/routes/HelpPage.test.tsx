import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/help", () => ({
  getHelpRules: vi.fn().mockResolvedValue({
    humanize: {
      words: ["plethora"],
      phrases: ["at the end of the day"],
      sentence_starters: ["Moreover"],
      patterns: [{ title: "Framing sandwich", body: "Don't restate the intro." }],
      lenses: [
        { key: "flow", title: "Flow & Rhythm", points: ["Vary sentence length."] },
        {
          key: "guardrail",
          title: "GUARDRAIL (all lenses)",
          points: ["Never invent, drop, or alter a fact, number, name, quotation, or link."],
        },
      ],
    },
    geo: {
      levers: [
        {
          key: "answer_first",
          label: "Answer-first sections",
          weight: 0.09,
          impact: "Engines quote the first 40-60 words.",
          detection: "judgment",
        },
      ],
    },
  }),
}));

import { HelpPage } from "../../src/routes/HelpPage";

describe("HelpPage", () => {
  it("renders live rule data in all sections", async () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("plethora")).toBeInTheDocument());
    expect(screen.getByText("Framing sandwich")).toBeInTheDocument();
    expect(screen.getByText("Answer-first sections")).toBeInTheDocument();
    expect(screen.getByText(/llms\.txt/i)).toBeInTheDocument(); // myths section
    expect(
      screen.getByText(/Never invent, drop, or alter a fact, number, name, quotation, or link\./i),
    ).toBeInTheDocument(); // guardrail callout, distinct from the four lens cards
  });
});
