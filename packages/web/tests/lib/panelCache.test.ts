import { beforeEach, describe, expect, it } from "vitest";

import type { Draft, Section } from "../../src/api/drafts";
import type { Reference } from "../../src/api/references";
import {
  combineAnalysisHash,
  formatAgo,
  getCached,
  hashDraftContent,
  hashReferenceFingerprint,
  setCached,
} from "../../src/lib/panelCache";

function sec(id: string, title: string, content: string): Section {
  return {
    id,
    title,
    brief: "",
    content_md: content,
    status: "edited",
    last_generated_at: null,
    word_count: content.split(/\s+/).length,
  };
}

function draft(sections: Section[], title = "T"): Draft {
  return {
    id: "d1",
    created_at: "",
    updated_at: "",
    title,
    stage: "sections",
    // biome-ignore lint/suspicious/noExplicitAny: minimal idea stub for the test
    idea: {} as any,
    outline: null,
    sections,
    tags: [],
    hero_image_key: null,
  };
}

describe("hashDraftContent", () => {
  it("is stable for identical content and changes when content changes", () => {
    const a = draft([sec("s1", "One", "Body")]);
    const b = draft([sec("s1", "One", "Body")]);
    expect(hashDraftContent(a)).toBe(hashDraftContent(b));

    const edited = draft([sec("s1", "One", "Body changed")]);
    expect(hashDraftContent(edited)).not.toBe(hashDraftContent(a));

    const retitled = draft([sec("s1", "One", "Body")], "Different");
    expect(hashDraftContent(retitled)).not.toBe(hashDraftContent(a));
  });
});

describe("reference-aware hashes", () => {
  const first: Reference = {
    id: "r1",
    kind: "url",
    name: "Primary source",
    url: "https://example.com/source",
    original_filename: null,
    extracted_chars: 1200,
    added_at: "2026-08-12T10:00:00Z",
  };
  const second: Reference = {
    id: "r2",
    kind: "file",
    name: "Research paper",
    url: null,
    original_filename: "paper.pdf",
    extracted_chars: 8400,
    added_at: "2026-08-12T11:00:00Z",
  };

  it("is stable across array order and changes with stable reference fields", () => {
    expect(hashReferenceFingerprint([first, second])).toBe(
      hashReferenceFingerprint([second, first]),
    );
    expect(hashReferenceFingerprint([{ ...first, extracted_chars: 1201 }, second])).not.toBe(
      hashReferenceFingerprint([first, second]),
    );
  });

  it("combines draft content and references without collisions between the parts", () => {
    expect(combineAnalysisHash("content-a", "references-b")).not.toBe(
      combineAnalysisHash("content", "a-references-b"),
    );
  });
});

describe("panel cache get/set", () => {
  beforeEach(() => localStorage.clear());

  it("returns cached data only when the hash matches", () => {
    setCached("geo", "d1", "hashA", { score: 80 }, 1000);
    expect(getCached("geo", "d1", "hashA")?.data).toEqual({ score: 80 });
    // Different hash → miss (content changed).
    expect(getCached("geo", "d1", "hashB")).toBeNull();
    // Different kind → separate slot.
    expect(getCached("shape", "d1", "hashA")).toBeNull();
  });

  it("a newer set overwrites the same (kind, draft) slot", () => {
    setCached("geo", "d1", "h1", { score: 1 }, 1000);
    setCached("geo", "d1", "h2", { score: 2 }, 2000);
    expect(getCached("geo", "d1", "h1")).toBeNull();
    expect(getCached("geo", "d1", "h2")?.data).toEqual({ score: 2 });
  });
});

describe("formatAgo", () => {
  it("renders friendly relative times", () => {
    const now = 1_000_000_000;
    expect(formatAgo(now - 5_000, now)).toBe("just now");
    expect(formatAgo(now - 120_000, now)).toBe("2 min ago");
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe("2 hr ago");
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe("3 d ago");
  });
});
