import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../src/api/client";
import * as ideation from "../../src/api/ideation";
import * as publishing from "../../src/api/publishing";
import * as references from "../../src/api/references";

afterEach(() => vi.unstubAllGlobals());

describe("references API module", () => {
  it("exports the expected functions", () => {
    expect(typeof references.listReferences).toBe("function");
    expect(typeof references.addUrlReference).toBe("function");
    expect(typeof references.addTextReference).toBe("function");
    expect(typeof references.addFileReference).toBe("function");
    expect(typeof references.deleteReference).toBe("function");
  });
});

describe("publishing API module", () => {
  it("exports the expected functions", () => {
    expect(typeof publishing.getPublishingSettings).toBe("function");
    expect(typeof publishing.savePublishingSettings).toBe("function");
    expect(typeof publishing.savePublishingToken).toBe("function");
    expect(typeof publishing.clearPublishingToken).toBe("function");
    expect(typeof publishing.validatePublishingSettings).toBe("function");
  });
});

describe("API errors", () => {
  it("preserves the stable structured error code separately from its message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: {
              error: {
                code: "github_branch_not_found",
                message: "Branch 'release' was not found.",
              },
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(api("/api/test")).rejects.toMatchObject({
      status: 404,
      code: "github_branch_not_found",
      message: "HTTP 404: Branch 'release' was not found.",
    });
  });
});

describe("ideation API module", () => {
  it("exports the expected functions", () => {
    expect(typeof ideation.listIdeation).toBe("function");
    expect(typeof ideation.postIdeationMessage).toBe("function");
    expect(typeof ideation.acceptIdeation).toBe("function");
  });
});
