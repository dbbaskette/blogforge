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

  it("retains a plain-text response only as technical detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("upstream gateway reset: request 7f8a", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    await expect(api("/api/test")).rejects.toMatchObject({
      status: 503,
      detail: "upstream gateway reset: request 7f8a",
      message: "The request could not be completed.",
    });
    await expect(api("/api/test")).rejects.not.toThrow(/gateway reset/);
  });

  it.each([
    {
      name: "structured upload validation",
      response: () =>
        new Response(
          JSON.stringify({
            detail: {
              error: {
                code: "reference_file_too_large",
                message: "The reference file is too large.",
              },
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      expected: {
        status: 422,
        code: "reference_file_too_large",
        message: "The reference file is too large.",
      },
    },
    {
      name: "expired upload session",
      response: () =>
        new Response(JSON.stringify({ detail: "session_revoked" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      expected: {
        status: 401,
        detail: "session_revoked",
        message: "Your session has expired. Please sign in again.",
      },
    },
    {
      name: "plain-text upload failure",
      response: () => new Response("storage temporarily offline", { status: 503 }),
      expected: {
        status: 503,
        detail: "storage temporarily offline",
        message: "The request could not be completed.",
      },
    },
  ])("uses the shared safe parser for $name", async ({ response, expected }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));

    await expect(
      references.addFileReference("d1", new File(["source"], "source.txt")),
    ).rejects.toMatchObject(expected);
  });
});

describe("ideation API module", () => {
  it("exports the expected functions", () => {
    expect(typeof ideation.listIdeation).toBe("function");
    expect(typeof ideation.postIdeationMessage).toBe("function");
    expect(typeof ideation.acceptIdeation).toBe("function");
  });
});
