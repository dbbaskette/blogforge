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
  sections: [{ id: "s1", content_md: "Latency dropped a lot last year." }],
  outline: { opening_hook: "", sections: [] },
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
    const apply = makeGeoApply({ draft, onSectionSave, onOpeningSave: vi.fn() });
    const res = await apply(citeIssue, "cite_source", "https://example.com");
    expect(inlineEdit).toHaveBeenCalled();
    // biome-ignore lint/suspicious/noExplicitAny: mock introspection
    const arg = (inlineEdit as any).mock.calls[0][1];
    expect(arg.instruction).toContain("https://example.com");
    expect(res?.after).toContain("Example");
    expect(onSectionSave).toHaveBeenCalledWith("s1", expect.stringContaining("Example"));
  });

  it("no-ops when the author gives no citation", async () => {
    const apply = makeGeoApply({ draft, onSectionSave: vi.fn(), onOpeningSave: vi.fn() });
    expect(await apply(citeIssue, "cite_source")).toBeNull();
  });
});
