import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/drafts", () => ({
  inlineEdit: vi
    .fn()
    .mockResolvedValue({ text: "Latency dropped, per [Example](https://example.com)." }),
}));
vi.mock("../../src/api/geo", () => ({
  generateFaq: vi.fn(),
  generateOpener: vi.fn(),
  generateTable: vi.fn(),
  generateTakeaways: vi.fn(),
  geoCite: vi.fn(),
  geoQuotes: vi.fn(),
}));
vi.mock("../../src/api/references", () => ({ listReferences: vi.fn().mockResolvedValue([]) }));

import { inlineEdit } from "../../src/api/drafts";
import { makeGeoApply } from "../../src/components/draft/geoApply";
import type { Issue } from "../../src/lib/issues/types";

// biome-ignore lint/suspicious/noExplicitAny: minimal Draft stub
const draft: any = {
  id: "d1",
  sections: [
    { id: "s1", title: "Reclaiming memory", content_md: "Latency dropped a lot last year." },
  ],
  outline: { opening_hook: "", sections: [{ id: "s1", title: "Reclaiming memory" }] },
};

const citeIssue: Issue = {
  id: "citations:0",
  panel: "geo",
  lever: "citations",
  title: "Uncited claim",
  why: "Ground it in a source.",
  nature: "fix",
  sectionId: "s1",
  target: "Latency dropped a lot last year.",
  actions: ["cite_source", "highlight"],
  status: "open",
};

describe("geoApply cite_source", () => {
  it("weaves the author-supplied citation into the passage via the model", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const res = await apply(citeIssue, "cite_source", "https://example.com");
    expect(inlineEdit).toHaveBeenCalled();
    // biome-ignore lint/suspicious/noExplicitAny: mock introspection
    const arg = (inlineEdit as any).mock.calls[0][1];
    expect(arg.instruction).toContain("https://example.com");
    expect(res?.after).toContain("Example");
    expect(onSectionSave).toHaveBeenCalledWith("s1", expect.stringContaining("Example"));
  });

  it("no-ops when the author gives no citation", async () => {
    const apply = makeGeoApply({
      draft,
      onSectionSave: vi.fn(),
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    expect(await apply(citeIssue, "cite_source")).toBeNull();
  });

  it("locates the section by target when the finding has no section_id", async () => {
    // The citations lever tags a target but no section_id — apply must find the
    // section whose body contains the claim instead of no-opping.
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const noSection: Issue = { ...citeIssue, sectionId: "" };
    const res = await apply(noSection, "cite_source", "https://example.com");
    expect(res).not.toBeNull();
    expect(res?.sectionId).toBe("s1");
    expect(onSectionSave).toHaveBeenCalledWith("s1", expect.stringContaining("Example"));
  });
});

describe("geoApply ai_fix", () => {
  it("rewrites the section title for a question-heading fix, not the body", async () => {
    const onTitleSave = vi.fn().mockResolvedValue(undefined);
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({ draft, onSectionSave, onOpeningSave: vi.fn(), onTitleSave });
    const issue: Issue = {
      id: "question_headings:0",
      panel: "geo",
      lever: "question_headings",
      title: "Heading isn't a question",
      why: "Question headings match how people search.",
      nature: "fix",
      sectionId: "s1",
      fixKind: "question_heading",
      actions: ["ai_fix", "manual_fix", "highlight"],
      status: "open",
    };
    const res = await apply(issue, "ai_fix");
    expect(onTitleSave).toHaveBeenCalled();
    expect(onSectionSave).not.toHaveBeenCalled();
    expect(res?.field).toBe("title");
  });

  it("uses a generic instruction when the lever has no specific one", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const issue: Issue = {
      id: "mystery:0",
      panel: "geo",
      lever: "mystery",
      title: "Some new issue kind",
      why: "It still needs fixing.",
      nature: "fix",
      sectionId: "s1",
      target: "Latency dropped a lot last year.",
      fixKind: "nonexistent",
      actions: ["ai_fix"],
      status: "open",
    };
    await apply(issue, "ai_fix");
    // biome-ignore lint/suspicious/noExplicitAny: mock introspection
    const arg = (inlineEdit as any).mock.calls.at(-1)[1];
    expect(arg.instruction).toContain("Some new issue kind");
    expect(onSectionSave).toHaveBeenCalled();
  });

  it("persist:false computes the rewrite via the model but does NOT save", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const issue: Issue = {
      id: "mystery:1",
      panel: "geo",
      lever: "mystery",
      title: "Some new issue kind",
      why: "It still needs fixing.",
      nature: "fix",
      sectionId: "s1",
      target: "Latency dropped a lot last year.",
      fixKind: "nonexistent",
      actions: ["ai_fix"],
      status: "open",
    };
    const res = await apply(issue, "ai_fix", undefined, { persist: false });
    expect(inlineEdit).toHaveBeenCalled();
    expect(res?.after).toContain("Example");
    expect(onSectionSave).not.toHaveBeenCalled();
  });

  it("ai_fix with a precomputed suggestion splices without a model call", async () => {
    // A citations claim matched to an attached source: target = the claim,
    // suggestion = the claim with a [title](url) markdown link inserted.
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const calls = (inlineEdit as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const issue: Issue = {
      id: "citations:0",
      panel: "geo",
      lever: "citations",
      title: "Uncited claim (matches your attached: Example)",
      why: "Cite the source you already attached.",
      nature: "fix",
      sectionId: "s1",
      target: "Latency dropped a lot last year.",
      suggestion: "Latency dropped a lot last year, per [Example](https://example.com).",
      fixKind: "cite_reference",
      actions: ["ai_fix", "manual_fix", "highlight"],
      status: "open",
    };
    const res = await apply(issue, "ai_fix");
    // No model call: inlineEdit's call count is unchanged.
    expect((inlineEdit as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    expect(res?.after).toContain("[");
    expect(res?.after).toContain("[Example](https://example.com)");
    expect(onSectionSave).toHaveBeenCalledWith("s1", expect.stringContaining("[Example]"));
  });

  it("ai_fix precomputed suggestion with persist:false returns after without saving", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const calls = (inlineEdit as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const issue: Issue = {
      id: "citations:1",
      panel: "geo",
      lever: "citations",
      title: "Uncited claim",
      why: "Cite the source you already attached.",
      nature: "fix",
      sectionId: "s1",
      target: "Latency dropped a lot last year.",
      suggestion: "Latency dropped a lot last year, per [Example](https://example.com).",
      fixKind: "cite_reference",
      actions: ["ai_fix", "manual_fix", "highlight"],
      status: "open",
    };
    const res = await apply(issue, "ai_fix", undefined, { persist: false });
    expect((inlineEdit as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    expect(res?.after).toContain("[Example](https://example.com)");
    expect(onSectionSave).not.toHaveBeenCalled();
  });

  it("splices a suggestion containing $ sequences verbatim (no String.replace mangling)", async () => {
    // A model-authored cite with a dollar amount and a URL query string that
    // holds `$$` and `$&`. A plain String.replace would treat those as
    // substitution patterns and corrupt the output; the splice must be verbatim.
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const suggestion = "Latency dropped a lot last year, saving $$5M via [Doc](https://x?a=$&b).";
    const issue: Issue = {
      id: "citations:2",
      panel: "geo",
      lever: "citations",
      title: "Uncited claim",
      why: "Cite the source you already attached.",
      nature: "fix",
      sectionId: "s1",
      target: "Latency dropped a lot last year.",
      suggestion,
      fixKind: "cite_reference",
      actions: ["ai_fix", "manual_fix", "highlight"],
      status: "open",
    };
    const res = await apply(issue, "ai_fix");
    expect(res?.after).toContain(suggestion);
    expect(onSectionSave).toHaveBeenCalledWith("s1", expect.stringContaining(suggestion));
  });

  it("rejects a precomputed cite whose target can't be located (no whole-section rewrite)", async () => {
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const calls = (inlineEdit as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const issue: Issue = {
      id: "citations:3",
      panel: "geo",
      lever: "citations",
      title: "Uncited claim",
      why: "Cite the source you already attached.",
      nature: "fix",
      sectionId: "s1",
      target: "A claim that no longer appears anywhere in the section.",
      suggestion: "A claim…, per [Doc](https://x).",
      fixKind: "cite_reference",
      actions: ["ai_fix", "manual_fix", "highlight"],
      status: "open",
    };
    await expect(apply(issue, "ai_fix")).rejects.toThrow(/changed since the pass ran/);
    // Never falls through to the model rewrite.
    expect((inlineEdit as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    expect(onSectionSave).not.toHaveBeenCalled();
  });

  it("gives a section-less input action a home (first section fallback)", async () => {
    // A freshness "add a date" finding carries no section and no target.
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const issue: Issue = {
      id: "freshness:0",
      panel: "geo",
      lever: "freshness",
      title: "No dates anywhere",
      why: "Recency signals help.",
      nature: "advisory",
      sectionId: "",
      fixKind: "freshness",
      actions: ["add_date", "dismiss"],
      status: "open",
    };
    const res = await apply(issue, "add_date", "March 2026");
    expect(res).not.toBeNull();
    expect(res?.sectionId).toBe("s1");
    expect(onSectionSave).toHaveBeenCalledWith("s1", expect.any(String));
  });
});

describe("geoApply block placement", () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal multi-section stub
  const multi: any = {
    id: "d1",
    sections: [
      { id: "s1", title: "Intro", content_md: "Opening section body." },
      { id: "s2", title: "Details", content_md: "Second section body." },
      { id: "s3", title: "Wrap-up", content_md: "Final section body." },
    ],
    outline: { opening_hook: "", sections: [] },
  };

  it("appends a generated FAQ to the LAST section, not the empty finding section", async () => {
    const { generateFaq } = await import("../../src/api/geo");
    (generateFaq as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { q: "How much does it cost?", a: "Free." },
    ]);
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft: multi,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const faqIssue: Issue = {
      id: "faq:0",
      panel: "geo",
      lever: "faq",
      title: 'Not covered: "cost"',
      why: "An FAQ helps answer engines.",
      nature: "add",
      sectionId: "",
      fixKind: "faq",
      actions: ["generate", "write_own"],
      status: "open",
    };
    const res = await apply(faqIssue, "generate");
    expect(res?.sectionId).toBe("s3");
    expect(onSectionSave).toHaveBeenCalledWith("s3", expect.stringContaining("FAQ"));
    // The last section's own body is preserved, not clobbered by another section.
    expect(onSectionSave).toHaveBeenCalledWith(
      "s3",
      expect.stringContaining("Final section body."),
    );
  });

  it("persist:false computes the appended takeaways block but does NOT save", async () => {
    const { generateTakeaways } = await import("../../src/api/geo");
    (generateTakeaways as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      "It is free.",
      "It is fast.",
    ]);
    const onSectionSave = vi.fn().mockResolvedValue(undefined);
    const apply = makeGeoApply({
      draft: multi,
      onSectionSave,
      onOpeningSave: vi.fn(),
      onTitleSave: vi.fn(),
    });
    const takeawaysIssue: Issue = {
      id: "takeaways:0",
      panel: "geo",
      lever: "takeaways",
      title: "No key takeaways",
      why: "A takeaways block helps answer engines.",
      nature: "add",
      sectionId: "",
      fixKind: "takeaways",
      actions: ["generate", "write_own"],
      status: "open",
    };
    const res = await apply(takeawaysIssue, "generate", undefined, { persist: false });
    // Takeaways prepend to the first section's body.
    expect(res?.sectionId).toBe("s1");
    expect(res?.after).toContain("Key takeaways");
    expect(res?.after).toContain("Opening section body.");
    expect(onSectionSave).not.toHaveBeenCalled();
  });
});
