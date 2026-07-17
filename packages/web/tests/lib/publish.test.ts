import { beforeEach, describe, expect, it } from "vitest";

import {
  buildFilename,
  loadPublishConfig,
  savePublishConfig,
  slugify,
} from "../../src/lib/publish";

describe("slugify", () => {
  it("kebab-cases and strips punctuation/quotes", () => {
    expect(slugify("“Faster is Still Safer” — the Three R’s")).toBe(
      "faster-is-still-safer-the-three-r-s",
    );
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("")).toBe("post");
    expect(slugify("   ---   ")).toBe("post");
  });
});

describe("buildFilename", () => {
  it("prefixes the date only for Jekyll", () => {
    expect(buildFilename("hugo", "my-post", "2026-07-01")).toBe("my-post.md");
    expect(buildFilename("plain", "my-post", "2026-07-01")).toBe("my-post.md");
    expect(buildFilename("jekyll", "my-post", "2026-07-01")).toBe("2026-07-01-my-post.md");
  });
});

describe("publish config persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips and falls back to defaults", () => {
    expect(loadPublishConfig().branch).toBe("main");
    savePublishConfig({
      owner: "d",
      repo: "b",
      branch: "gh-pages",
      dir: "_posts",
      preset: "jekyll",
    });
    const loaded = loadPublishConfig();
    expect(loaded.owner).toBe("d");
    expect(loaded.preset).toBe("jekyll");
  });
});
