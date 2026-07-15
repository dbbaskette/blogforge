/**
 * Map the Shape Assistant's suggestions into the unified Issue model.
 *
 * Shape is the one pass whose cards offer a CHOICE: reword hands the writer N
 * alternative phrasings and expand hands them N ideas. Those become `options`
 * + a `choose_option` action, so picking one flows through the same
 * preview → confirm → accept/undo path as every other fix. fact_check has
 * nothing to apply — it's guidance — so it's advisory.
 */

import type { SuggestKind, SuggestResult } from "../../api/suggest";
import { makeIdFactory } from "./issueIds";
import type { Issue, IssueAction, IssueNature } from "./types";

interface KindSpec {
  label: string;
  detail: string;
  nature: IssueNature;
  actions: IssueAction[];
}

// No `highlight` anywhere: Shape's suggestions carry no section_id (apply
// resolves the section by searching for the target), and ShapePanel is a
// standalone overlay with no read-pane to jump to — so a Highlight button would
// render, no-op silently, and lie about what it does.
const SPEC: Record<SuggestKind, KindSpec> = {
  fact_check: {
    label: "Claims to verify",
    detail: "Statements a reader (or an AI) would want a source for.",
    nature: "advisory",
    actions: ["dismiss"],
  },
  reword: {
    label: "Sharper phrasing",
    detail: "Alternatives kept in your voice. Pick one to apply it.",
    nature: "fix",
    actions: ["choose_option", "manual_fix", "dismiss"],
  },
  expand: {
    label: "Places to add substance",
    detail: "Thin spots worth developing. Pick an angle to expand it.",
    nature: "add",
    actions: ["choose_option", "write_own", "dismiss"],
  },
};

/** Render order for the rail: verify first, then tighten, then grow. */
export const SHAPE_GROUPS: { key: SuggestKind; label: string; detail: string }[] = (
  ["fact_check", "reword", "expand"] as SuggestKind[]
).map((key) => ({ key, label: SPEC[key].label, detail: SPEC[key].detail }));

export function shapeSuggestionsToIssues(result: SuggestResult): Issue[] {
  const nextId = makeIdFactory();
  const issues: Issue[] = [];
  for (const { key } of SHAPE_GROUPS) {
    const spec = SPEC[key];
    for (const s of result[key] ?? []) {
      // A pass can come back with a suggestion but no alternatives. Without
      // options there is nothing to choose, so drop `choose_option` rather than
      // render a "Pick one" button that opens nothing.
      const options = spec.actions.includes("choose_option") ? (s.options ?? []) : [];
      const actions = options.length
        ? spec.actions
        : spec.actions.filter((a) => a !== "choose_option");
      issues.push({
        id: nextId("shape", key, { target: s.target, title: s.note }),
        panel: "shape",
        lever: key,
        title: s.note,
        // The group detail already explains the kind; a per-suggestion rationale
        // would just repeat it, and the rail's dedupe would drop it anyway.
        why: "",
        nature: spec.nature,
        sectionId: "",
        target: s.target,
        fixKind: key,
        options: options.length ? options : undefined,
        actions,
        status: "open",
      });
    }
  }
  return issues;
}
