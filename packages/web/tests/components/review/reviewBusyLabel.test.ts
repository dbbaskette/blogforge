import { describe, expect, it } from "vitest";

import { reviewBusyLabel } from "../../../src/components/review/reviewBusyLabel";

describe("reviewBusyLabel", () => {
  it("labels slow model actions", () => {
    expect(reviewBusyLabel("ai_fix")).toBe("Applying the AI fix…");
    expect(reviewBusyLabel("generate")).toBe("Generating…");
    expect(reviewBusyLabel("add_fact")).toBe("Weaving in your fact…");
    expect(reviewBusyLabel("cite_source")).toBe("Citing the source…");
  });

  it("returns null for fast/local actions and undo", () => {
    expect(reviewBusyLabel("manual_fix")).toBeNull();
    expect(reviewBusyLabel("dismiss")).toBeNull();
    expect(reviewBusyLabel("dedupe")).toBeNull();
    expect(reviewBusyLabel("undo")).toBeNull();
    expect(reviewBusyLabel(null)).toBeNull();
  });
});
