/**
 * The GEO panel's apply function, factored out of GeoPanel so the shared
 * review rail (GeoReviewRail + useIssueLifecycle) can drive every GEO fix
 * through one code path. `makeGeoApply` closes over the draft and its save
 * callbacks and returns the `apply(issue, action, input?)` the lifecycle hook
 * calls; each IssueAction maps to the existing drafts/geo API clients.
 *
 * Apply is responsible for PERSISTING the change (it calls onSectionSave /
 * onOpeningSave itself) and returning `{ sectionId, before, after, highlight }`
 * so the hook can highlight the run and record undo. Returning null no-ops the
 * card gracefully (e.g. an action that needs a reference the draft lacks).
 */

import { type Draft, inlineEdit } from "../../api/drafts";
import {
  generateFaq,
  generateOpener,
  generateTable,
  generateTakeaways,
  geoCite,
  geoQuotes,
} from "../../api/geo";
import { listReferences } from "../../api/references";
import type { Issue, IssueAction } from "../../lib/issues/types";
import type { Applied } from "../review/useIssueLifecycle";

/**
 * Voice-aware rewrite instructions, keyed by lever. These are the exact strings
 * GeoPanel used for its per-lever AI fixes, so applying a fix through the rail
 * produces byte-identical model requests to the old bespoke UI.
 */
export const INSTRUCTION: Record<string, string> = {
  answer_first:
    "Rewrite this section so it OPENS with a direct, self-contained answer of about 40-60 words, then the supporting detail. Keep the author's voice and all substance. Return only the section body, no heading.",
  // Applied to ONE dense paragraph (the finding's target), not the section.
  skimmability:
    "Convert this single dense paragraph into a one-sentence lead-in followed by 3-6 tight bullets (one idea each). Keep the author's voice and every fact. Return only the replacement markdown.",
  chunking:
    "Rewrite this section so it stands alone: replace back-references like 'as mentioned above' or 'in the previous section' with the actual context in a few words. Keep the author's voice and all substance. Return only the section body, no heading.",
  definitional_opener:
    "This is the article's intro/lede. Do NOT summarize, shorten, or drop any of it. Return the ENTIRE intro with only a light touch: make its FIRST sentence a clean, standalone, citable one-line definition of the article's subject/thesis — reword that first sentence, or add one short sentence at the very start — then keep every other sentence exactly as written, in the same order. Keep the author's voice; invent nothing. Return the full intro prose, no heading.",
  brand_explicit:
    "Rewrite this section so the product/brand is named explicitly at least once (instead of leaning on 'it'/'the tool'/'our platform'), naturally and in the author's voice. Keep all substance. Return only the section body, no heading.",
};

const OPENING = "opening";

/** Keep only the first copy of a back-to-back duplicated opening block (the
 * server identifies the block; sentence boundary mirrors its regex). Duplicated
 * from GeoPanel so the deterministic dedupe fix survives the refactor. */
export function dedupeOpeningBlock(block: string): string {
  const m = /(?<=[.!?])["'”’)]*\s+/.exec(block);
  if (!m) return block;
  const trailer = m[0].replace(/\s+$/, "");
  return block.slice(0, m.index + trailer.length);
}

/** Build a "### FAQ" markdown block from generated Q/A pairs. */
function faqBlock(faqs: { q: string; a: string }[]): string {
  return `### FAQ\n\n${faqs.map((f) => `**${f.q}**\n\n${f.a}`).join("\n\n")}`;
}

/** Build a "Key takeaways" bullet block from generated bullets. */
function takeawaysBlock(bullets: string[]): string {
  return `**Key takeaways**\n\n${bullets.map((b) => `- ${b}`).join("\n")}`;
}

export interface GeoApplyContext {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onOpeningSave: (next: string) => Promise<void>;
}

/**
 * Read the current text an issue operates on: a section's markdown, or the
 * article opening (outline.opening_hook) for the synthetic "opening" section.
 */
function readSource(draft: Draft, sectionId: string): string {
  if (sectionId === OPENING) return draft.outline?.opening_hook ?? "";
  return draft.sections.find((s) => s.id === sectionId)?.content_md ?? "";
}

export function makeGeoApply(
  ctx: GeoApplyContext,
): (issue: Issue, action: IssueAction, input?: string) => Promise<Applied | null> {
  const { draft, onSectionSave, onOpeningSave } = ctx;

  /** Persist a new body for the issue's section (or the opening). */
  const save = async (sectionId: string, next: string): Promise<void> => {
    if (sectionId === OPENING) {
      await onOpeningSave(next);
    } else {
      await onSectionSave(sectionId, next);
    }
  };

  return async (issue: Issue, action: IssueAction, input?: string): Promise<Applied | null> => {
    const sectionId = issue.sectionId;
    const before = readSource(draft, sectionId);
    // The passage a fix targets — the flagged span, or the whole section.
    const target = issue.target && before.includes(issue.target) ? issue.target : null;

    switch (action) {
      case "ai_fix": {
        const instruction = INSTRUCTION[issue.lever];
        if (!instruction) return null;
        const source = target ?? before;
        if (!source.trim()) return null;
        const { text } = await inlineEdit(draft.id, {
          text: source,
          action: "custom",
          instruction,
        });
        const fixed = text.trim();
        const after = target ? before.replace(target, fixed) : fixed;
        await save(sectionId, after);
        return { sectionId, before, after, highlight: fixed };
      }

      case "manual_fix": {
        if (!input) return null;
        const after = target ? before.replace(target, input) : input;
        await save(sectionId, after);
        return { sectionId, before, after, highlight: input };
      }

      case "add_fact":
      case "add_date": {
        if (!input) return null;
        const source = target ?? before;
        if (!source.trim()) return null;
        const { text } = await inlineEdit(draft.id, {
          text: source,
          action: "custom",
          instruction: `Weave this real, author-supplied fact into the passage naturally and in the author's voice. Do not invent anything. Fact: "${input}"`,
        });
        const woven = text.trim();
        const after = target ? before.replace(target, woven) : woven;
        await save(sectionId, after);
        return { sectionId, before, after, highlight: woven };
      }

      case "generate": {
        const block = await generateBlock(draft, issue);
        if (block === null) return null;
        return applyBlock(draft, issue, block, before, save);
      }

      case "write_own": {
        if (!input) return null;
        return applyBlock(draft, issue, input, before, save);
      }

      case "cite_source":
      case "quote_source": {
        if (!target) return null;
        const refs = await listReferences(draft.id);
        const ref = refs[0];
        if (!ref) return null;
        let quote: string | undefined;
        if (action === "quote_source") {
          const quotes = await geoQuotes(draft.id, ref.id);
          quote = quotes[0];
          if (!quote) return null;
        }
        const passage = await geoCite(draft.id, {
          section_id: sectionId,
          target,
          reference_id: ref.id,
          quote,
        });
        const fixed = passage.trim();
        const after = before.replace(target, fixed);
        await save(sectionId, after);
        return { sectionId, before, after, highlight: fixed };
      }

      case "dedupe": {
        if (!target) return null;
        const after = before.replace(target, dedupeOpeningBlock(target));
        if (after === before) return null;
        await save(sectionId, after);
        return { sectionId, before, after, highlight: dedupeOpeningBlock(target) };
      }

      case "dismiss":
        // No content change; the lifecycle hook special-cases dismiss to green.
        return { sectionId, before: "", after: "" };

      default:
        return null;
    }
  };
}

/**
 * Generate the block a `generate` action inserts, chosen by lever. Returns null
 * if nothing usable came back (the card no-ops).
 */
async function generateBlock(draft: Draft, issue: Issue): Promise<string | null> {
  switch (issue.lever) {
    case "faq": {
      const faqs = await generateFaq(draft.id);
      return faqs.length ? faqBlock(faqs) : null;
    }
    case "takeaways": {
      const bullets = await generateTakeaways(draft.id);
      return bullets.length ? takeawaysBlock(bullets) : null;
    }
    case "comparison_table": {
      const table = await generateTable(draft.id, issue.sectionId);
      return table ? table : null;
    }
    case "definitional_opener": {
      const opener = await generateOpener(draft.id);
      return opener ? opener : null;
    }
    default:
      return null;
  }
}

/**
 * Insert a generated/authored block per the lever's placement rule: FAQ +
 * comparison tables append to the section; takeaways prepend to the first
 * section; a definitional opener prepends to the article opening.
 */
async function applyBlock(
  draft: Draft,
  issue: Issue,
  block: string,
  before: string,
  save: (sectionId: string, next: string) => Promise<void>,
): Promise<Applied | null> {
  const clean = block.trim();
  if (!clean) return null;

  if (issue.lever === "takeaways") {
    const first = draft.sections[0];
    if (!first) return null;
    const base = first.content_md;
    const after = `${clean}\n\n${base.trim()}`;
    await save(first.id, after);
    return { sectionId: first.id, before: base, after, highlight: clean };
  }

  if (issue.lever === "definitional_opener") {
    const existing = (draft.outline?.opening_hook ?? "").trim();
    const after = existing ? `${clean}\n\n${existing}` : clean;
    await save("opening", after);
    return { sectionId: "opening", before: existing, after, highlight: clean };
  }

  // faq / comparison_table: append to the issue's section.
  const after = `${before.trim()}\n\n${clean}`;
  await save(issue.sectionId, after);
  return { sectionId: issue.sectionId, before, after, highlight: clean };
}
