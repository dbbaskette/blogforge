import { describe, expect, it } from "vitest";

import { buildGeoSetup } from "../../src/lib/geoSetup";

describe("buildGeoSetup", () => {
  it("covers the site-level GEO levers the per-post panel can't check", () => {
    const md = buildGeoSetup();
    // AI crawler allowlist — the most common invisible failure.
    for (const bot of ["OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "Google-Extended"]) {
      expect(md).toContain(bot);
    }
    expect(md).toMatch(/server-side|JavaScript/i);
    expect(md).toMatch(/JSON-LD|FAQPage|Article/);
    expect(md).toMatch(/E-E-A-T|author bio/i);
    expect(md).toMatch(/lastmod|dateModified|freshness/i);
  });

  it("names the target repo when config is provided", () => {
    expect(buildGeoSetup({ owner: "acme", repo: "blog" })).toContain("acme/blog");
  });
});
