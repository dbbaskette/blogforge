/**
 * The Proofreader's apply function, mirroring LintPanel's AI-fix behavior but
 * driving it through the shared review lifecycle. An AI fix locates the flagged
 * match, expands to its enclosing sentence, rewrites that sentence in voice, and
 * splices it back — the same recipe LintPanel used.
 */

import { type Draft, inlineEdit } from "../../api/drafts";
import type { Issue, IssueAction } from "../../lib/issues/types";
import type { Applied } from "../review/useIssueLifecycle";

/** Expand a match span to its enclosing sentence (mirrors LintPanel). */
function enclosingSpan(text: string, start: number, end: number): { s: number; e: number } {
  const boundary = (c: string): boolean => c === "." || c === "!" || c === "?" || c === "\n";
  let s = start;
  while (s > 0 && !boundary(text[s - 1])) s--;
  while (s < start && /\s/.test(text[s])) s++;
  let e = end;
  while (e < text.length && !boundary(text[e])) e++;
  if (e < text.length) e++;
  return { s, e };
}

function fixInstruction(issue: Issue): string {
  const target = issue.target ? `the flagged text "${issue.target}"` : "the flagged wording";
  return `Rewrite this sentence to remove ${target}, recasting it naturally while keeping the meaning and the author's voice. Do not use em dashes. Return only the rewritten sentence.`;
}

export interface ProofreadApplyContext {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string) => Promise<void>;
}

export function makeProofreadApply(
  ctx: ProofreadApplyContext,
): (
  issue: Issue,
  action: IssueAction,
  input?: string,
  opts?: { persist?: boolean },
) => Promise<Applied | null> {
  const { draft, onSectionSave } = ctx;

  return async (
    issue: Issue,
    action: IssueAction,
    input?: string,
    opts?: { persist?: boolean },
  ): Promise<Applied | null> => {
    if (action === "dismiss") return { sectionId: issue.sectionId, before: "", after: "" };

    const section = draft.sections.find((s) => s.id === issue.sectionId);
    if (!section || !issue.target) return null;
    const before = section.content_md;
    const idx = before.indexOf(issue.target);
    if (idx < 0) return null;
    const span = enclosingSpan(before, idx, idx + issue.target.length);
    const sentence = before.slice(span.s, span.e);

    let replacement: string;
    if (action === "manual_fix") {
      if (!input) return null;
      replacement = input;
    } else if (action === "ai_fix") {
      const { text } = await inlineEdit(draft.id, {
        text: sentence,
        action: "custom",
        instruction: fixInstruction(issue),
      });
      replacement = text.trim();
      if (!replacement) return null;
    } else {
      return null;
    }

    const after = before.slice(0, span.s) + replacement + before.slice(span.e);
    if (opts?.persist !== false) await onSectionSave(section.id, after);
    return { sectionId: section.id, before, after, highlight: replacement };
  };
}
