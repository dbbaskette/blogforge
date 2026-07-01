import { describe, expect, it } from "vitest";

import { stripInlineEmphasis } from "../../src/lib/headingText";

describe("stripInlineEmphasis", () => {
  it("removes bold markers from a heading", () => {
    expect(stripInlineEmphasis("**ROTATE: Beyond static secrets**")).toBe(
      "ROTATE: Beyond static secrets",
    );
    expect(stripInlineEmphasis("__REPAVE__")).toBe("REPAVE");
  });

  it("removes italic, code, and mixed emphasis", () => {
    expect(stripInlineEmphasis("*Faster* is `still` safer")).toBe("Faster is still safer");
    expect(stripInlineEmphasis("**Bold** and *italic*")).toBe("Bold and italic");
  });

  it("drops stray/unbalanced markers (e.g. a truncated title)", () => {
    expect(stripInlineEmphasis("**Faster is Still Safer: The Three R's")).toBe(
      "Faster is Still Safer: The Three R's",
    );
  });

  it("leaves snake_case and clean headings untouched", () => {
    expect(stripInlineEmphasis("The Three R's of Enterprise Security")).toBe(
      "The Three R's of Enterprise Security",
    );
    expect(stripInlineEmphasis("configure the get_user_id flag")).toBe(
      "configure the get_user_id flag",
    );
  });
});
