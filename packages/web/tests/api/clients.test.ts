import { describe, expect, it } from "vitest";

import * as ideation from "../../src/api/ideation";
import * as references from "../../src/api/references";

describe("references API module", () => {
  it("exports the expected functions", () => {
    expect(typeof references.listReferences).toBe("function");
    expect(typeof references.addUrlReference).toBe("function");
    expect(typeof references.addTextReference).toBe("function");
    expect(typeof references.addFileReference).toBe("function");
    expect(typeof references.deleteReference).toBe("function");
  });
});

describe("ideation API module", () => {
  it("exports the expected functions", () => {
    expect(typeof ideation.listIdeation).toBe("function");
    expect(typeof ideation.postIdeationMessage).toBe("function");
    expect(typeof ideation.acceptIdeation).toBe("function");
  });
});
