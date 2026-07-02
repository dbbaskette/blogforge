import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { buildDecorations } from "../../src/components/draft/trackedChangeDecoration";

const schema = new Schema({ nodes: { doc: { content: "text*" }, text: {} } });
const doc = schema.node("doc", null, [schema.text("Hello world foo bar and foo again")]);

describe("buildDecorations", () => {
  it("decorates every occurrence of a run", () => {
    const set = buildDecorations(doc, [{ text: "foo", kind: "under-review" }]);
    expect(set.find().length).toBe(2);
  });

  it("tags decorations with the run's kind class", () => {
    const set = buildDecorations(doc, [{ text: "world", kind: "locate" }]);
    const deco = set.find()[0] as unknown as { type: { attrs: { class: string } } };
    expect(deco.type.attrs.class).toContain("tracked-change--locate");
  });

  it("ignores empty runs", () => {
    expect(buildDecorations(doc, []).find().length).toBe(0);
    expect(buildDecorations(doc, [{ text: "   ", kind: "pending" }]).find().length).toBe(0);
  });
});
