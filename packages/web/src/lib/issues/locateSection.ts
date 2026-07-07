/**
 * Resolve which draft section a finding belongs to when the backend tagged a
 * `target` claim but no `section_id` (the citations and factual_density levers
 * do this). Matching an LLM-extracted claim is brittle as a raw substring — the
 * model paraphrases and re-quotes — so we go exact → normalized → distinctive-
 * token overlap, and only fall back to the first section as a last resort so a
 * fix/highlight/undo always has a real home instead of silently no-opping.
 */

import type { Issue } from "./types";

export interface SectionLike {
  id: string;
  content_md: string;
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

// Common words carry no locating signal; drop them before scoring overlap.
const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "is",
  "it",
  "that",
  "this",
  "with",
  "for",
  "on",
  "as",
  "are",
  "was",
  "were",
  "by",
  "at",
  "its",
  "not",
  "but",
  "without",
  "given",
  "where",
  "which",
  "they",
  "their",
  "them",
  "from",
  "into",
  "than",
  "then",
  "when",
  "what",
  "does",
  "you",
  "your",
]);

const tokens = (s: string): string[] =>
  norm(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOP.has(t));

/**
 * Best section id for a target claim, or null when there are no sections / no
 * target. Exact and normalized substring hits win outright; otherwise the
 * section sharing the most distinctive tokens with the target; first section as
 * the final fallback so a non-empty target always resolves somewhere.
 */
export function sectionForTarget(target: string, sections: SectionLike[]): string | null {
  if (!target?.trim() || sections.length === 0) return null;
  const exact = sections.find((s) => s.content_md.includes(target));
  if (exact) return exact.id;
  const nt = norm(target);
  const fuzzy = sections.find((s) => norm(s.content_md).includes(nt));
  if (fuzzy) return fuzzy.id;

  const want = new Set(tokens(target));
  if (want.size === 0) return sections[0].id;
  let best = sections[0];
  let bestHits = -1;
  for (const s of sections) {
    const body = new Set(tokens(s.content_md));
    let hits = 0;
    for (const t of want) if (body.has(t)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      best = s;
    }
  }
  return best.id;
}

/**
 * Fill in each issue's `sectionId` when the finding didn't carry one, by
 * locating its `target` in the draft body. Returns new issues (no mutation) so
 * highlight, apply, and undo all read the same resolved section.
 */
export function fillSectionIds(issues: Issue[], sections: SectionLike[]): Issue[] {
  return issues.map((issue) => {
    if (issue.sectionId || !issue.target) return issue;
    const id = sectionForTarget(issue.target, sections);
    return id ? { ...issue, sectionId: id } : issue;
  });
}
