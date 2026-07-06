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
});
