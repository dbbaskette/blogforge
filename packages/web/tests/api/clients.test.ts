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
                repository_url: "https://github.com/blogforge/example",
                path: "content/release.md",
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
      message: "Branch 'release' was not found.",
      repositoryUrl: "https://github.com/blogforge/example",
      path: "content/release.md",
    });
  });

  it("keeps validation detail available without using its JSON as the message", async () => {
    const validation = [{ loc: ["body", "title"], msg: "Field required", type: "missing" }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: validation }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(api("/api/test")).rejects.toMatchObject({
      status: 422,
      detail: validation,
      message: "The request could not be completed.",
    });
    await expect(api("/api/test")).rejects.not.toThrow(/\[\{|\"loc\"/);
  });

  it("keeps an opaque session detail as metadata without forcing navigation", async () => {
    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, pathname: "/drafts/d1", assign },
    });
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ detail: "session_revoked" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await expect(api("/api/test")).rejects.toMatchObject({
        status: 401,
        detail: "session_revoked",
        message: "Your session has expired. Please sign in again.",
      });
      expect(assign).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});

describe("ideation API module", () => {
  it("exports the expected functions", () => {
    expect(typeof ideation.listIdeation).toBe("function");
    expect(typeof ideation.postIdeationMessage).toBe("function");
    expect(typeof ideation.acceptIdeation).toBe("function");
  });
});
