import { describe, expect, it } from "vitest";

import { type BuildInfo, versionLabel, versionTitle } from "../../src/lib/version";

const built: BuildInfo = { version: "0.1.0", sha: "49bd6cb", builtAt: "2026-07-02T00:29:20Z" };
const dev: BuildInfo = { version: "0.1.0", sha: "dev", builtAt: "" };

describe("version label", () => {
  it("shows semver and the git SHA — the deploy-identity signal", () => {
    expect(versionLabel(built)).toBe("v0.1.0 · 49bd6cb");
  });

  it("reads 'dev' when not built with a SHA", () => {
    expect(versionLabel(dev)).toBe("v0.1.0 · dev");
    expect(versionTitle(dev)).toBe("Local dev build");
  });

  it("puts the build time in the tooltip", () => {
    expect(versionTitle(built)).toContain("2026-07-02T00:29:20Z");
  });
});
