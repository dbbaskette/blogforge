import { beforeEach, describe, expect, it } from "vitest";

import { type ComposeSettings, loadDefaults, saveDefaults } from "../../src/lib/composeDefaults";

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
      provider: "anthropic",
      model: "",
      target_words: 1500,
      use_voice_profile: true,
    });
  });

  it("round-trips saved settings", () => {
    saveDefaults(sample);
    expect(loadDefaults()).toEqual(sample);
  });

  it("returns the fallback when stored JSON is corrupt", () => {
    localStorage.setItem("bf.compose.defaults", "{not json");
    expect(loadDefaults().target_words).toBe(1500);
  });
});
