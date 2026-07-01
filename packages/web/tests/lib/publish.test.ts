import { beforeEach, describe, expect, it } from "vitest";

import {
  type PublishConfig,
  buildFilename,
  loadPublishConfig,
  newFileUrl,
  savePublishConfig,
  slugify,
  willPrefillContent,
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

describe("newFileUrl", () => {
  const cfg: PublishConfig = {
    owner: "dan",
    repo: "blog",
    branch: "main",
    dir: "content/posts",
    preset: "hugo",
  };

  it("puts the dir in the path and filename in the query, prefilling short content", () => {
    const url = new URL(newFileUrl(cfg, "my-post.md", "# hi"));
    expect(url.pathname).toBe("/dan/blog/new/main/content/posts");
    expect(url.searchParams.get("filename")).toBe("my-post.md");
    expect(url.searchParams.get("value")).toBe("# hi");
  });

  it("omits value (clipboard fallback) when content is too long", () => {
    const long = "x".repeat(7000);
    const url = new URL(newFileUrl(cfg, "p.md", long));
    expect(url.searchParams.get("value")).toBeNull();
    expect(willPrefillContent(long)).toBe(false);
    expect(willPrefillContent("short")).toBe(true);
  });

  it("handles an empty dir", () => {
    const url = new URL(newFileUrl({ ...cfg, dir: "" }, "p.md", "x"));
    expect(url.pathname).toBe("/dan/blog/new/main");
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
