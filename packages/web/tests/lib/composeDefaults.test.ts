import { beforeEach, describe, expect, it } from "vitest";

import {
  type ComposeSettings,
  loadDefaults,
  loadLastMode,
  saveDefaults,
  saveLastMode,
} from "../../src/lib/composeDefaults";

const sample: ComposeSettings = {
  pack_slug: "house",
  format: "essay",
  provider: "openai",
  model: "gpt-x",
  target_words: 2000,
  use_voice_profile: false,
};

describe("composeDefaults", () => {
  beforeEach(() => localStorage.clear());

  it("returns the fallback when nothing is stored", () => {
    expect(loadDefaults()).toEqual({
      pack_slug: "",
      format: null,
      provider: "claude-cli",
      model: "",
      target_words: 1500,
      use_voice_profile: true,
    });
  });

  it("round-trips saved settings", () => {
    saveDefaults(sample);
    expect(loadDefaults()).toEqual({ ...sample, provider: "claude-cli" });
  });

  it("does not persist provider ownership in browser defaults", () => {
    saveDefaults(sample);
    expect(JSON.parse(localStorage.getItem("bf.compose.defaults") ?? "{}")).not.toHaveProperty(
      "provider",
    );
  });

  it("ignores a provider left behind by an older browser payload", () => {
    localStorage.setItem("bf.compose.defaults", JSON.stringify(sample));
    expect(loadDefaults()).toEqual({ ...sample, provider: "claude-cli" });
  });

  it("returns the fallback when stored JSON is corrupt", () => {
    localStorage.setItem("bf.compose.defaults", "{not json");
    expect(loadDefaults().target_words).toBe(1500);
  });

  it("round-trips the last-used mode", () => {
    expect(loadLastMode()).toBeNull();
    saveLastMode("outline");
    expect(loadLastMode()).toBe("outline");
  });

  it("ignores an unknown stored mode", () => {
    localStorage.setItem("bf.compose.lastMode", "bogus");
    expect(loadLastMode()).toBeNull();
  });
});
