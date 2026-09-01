import { afterEach, describe, expect, it, vi } from "vitest";

import { generateHeroImage } from "../../src/api/drafts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateHeroImage", () => {
  it("sends theme and direction while keeping prompt optional", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hero_image_key: "key" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateHeroImage("draft 1", {
      theme: "space",
      direction: "A playful retro space scene",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/drafts/draft%201/hero-image");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      theme: "space",
      direction: "A playful retro space scene",
    });
  });

  it("continues to accept the legacy full-prompt string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hero_image_key: "key" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateHeroImage("draft-1", "A hand-authored image prompt");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ prompt: "A hand-authored image prompt" });
  });
});
