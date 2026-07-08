import { describe, expect, it } from "vitest";

import { shouldShowDraftTools } from "../../src/components/draft/draftTools";

// biome-ignore lint/suspicious/noExplicitAny: minimal Section stubs
const sec = (status: string): any => ({ status });

describe("shouldShowDraftTools", () => {
  it("shows the toolbar in the sections stage with sections", () => {
    expect(shouldShowDraftTools("sections", [sec("ready")])).toBe(true);
  });

  it("hides the toolbar with no sections at all", () => {
    expect(shouldShowDraftTools("outline", [])).toBe(false);
    expect(shouldShowDraftTools("sections", [])).toBe(false);
  });

  // The reported bug: a fully-composed draft resumed on (or navigated back to)
  // the outline stage lost GEO / Voice / lint / Humanize / Export entirely.
  it("KEEPS the toolbar on the outline stage when the draft already has composed content", () => {
    expect(shouldShowDraftTools("outline", [sec("ready"), sec("edited")])).toBe(true);
  });

  it("keeps the toolbar on the research stage when content exists", () => {
    expect(shouldShowDraftTools("research", [sec("edited")])).toBe(true);
  });

  it("stays hidden on an earlier stage when nothing is composed yet", () => {
    // A brand-new outline with only empty section shells — nothing to optimize
    // or export, so the tools correctly stay hidden until the writer composes.
    expect(shouldShowDraftTools("outline", [sec("pending"), sec("generating")])).toBe(false);
  });
});
