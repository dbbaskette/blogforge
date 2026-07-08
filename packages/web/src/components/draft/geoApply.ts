/**
 * The GEO panel's apply function: `makeGeoApply` closes over the draft and its
 * save callbacks and returns the `apply(issue, action, input?)` the lifecycle
 * hook calls. Dispatch is keyed on `issue.fixKind` (the backend's specific fix
 * tag) so a lever that hosts several fix kinds resolves precisely; an AI fix
 * with no lever-specific instruction still works via a generic fallback, so no
 * button silently does nothing.
 *
 * Apply persists the change itself (routing to section body / title / opening)
 * and returns `{ sectionId, before, after, highlight, field }` so the hook can
 * highlight the run and undo to the right field. Returning null no-ops the card.
 */

import { type Draft, inlineEdit } from "../../api/drafts";
import {
  generateFaq,
  generateOpener,
  generateTable,
  generateTakeaways,
  geoAlt,
  geoCite,
  geoQuotes,
} from "../../api/geo";
import { listReferences } from "../../api/references";
import { sectionForTarget } from "../../lib/issues/locateSection";
import type { Issue, IssueAction } from "../../lib/issues/types";
import type { Applied, AppliedField } from "../review/useIssueLifecycle";

/** Voice-aware rewrite instructions, keyed by the specific fix tag (fixKind). */
export const INSTRUCTION: Record<string, string> = {
  answer_first:
    "Rewrite this section so it OPENS with a direct, self-contained answer of about 40-60 words, then the supporting detail. Keep the author's voice and all substance. Return only the section body, no heading.",
  bullets:
    "Convert this single dense paragraph into a one-sentence lead-in followed by 3-6 tight bullets (one idea each). Keep the author's voice and every fact. Return only the replacement markdown.",
  self_contained:
    "Rewrite this section so it stands alone: replace back-references like 'as mentioned above' or 'in the previous section' with the actual context in a few words. Keep the author's voice and all substance. Return only the section body, no heading.",
  definitional_improve:
    "This is the article's intro/lede. Do NOT summarize, shorten, or drop any of it. Return the ENTIRE intro with only a light touch: make its FIRST sentence a clean, standalone, citable one-line definition of the article's subject/thesis — reword that first sentence, or add one short sentence at the very start — then keep every other sentence exactly as written, in the same order. Keep the author's voice; invent nothing. Return the full intro prose, no heading.",
  brand_explicit:
    "Rewrite this section so the product/brand is named explicitly at least once (instead of leaning on 'it'/'the tool'/'our platform'), naturally and in the author's voice. Keep all substance. Return only the section body, no heading.",
  factual_density:
    "Tighten this passage: cut buzzwords and vague filler, keep every concrete fact and the author's voice. Do NOT invent statistics or sources. Return only the revised passage, no heading.",
};

const OPENING = "opening";

/** Keep only the first copy of a back-to-back duplicated opening block. */
export function dedupeOpeningBlock(block: string): string {
  const m = /(?<=[.!?])["'”’)]*\s+/.exec(block);
  if (!m) return block;
  const trailer = m[0].replace(/\s+$/, "");
  return block.slice(0, m.index + trailer.length);
}

function faqBlock(faqs: { q: string; a: string }[]): string {
  return `### FAQ\n\n${faqs.map((f) => `**${f.q}**\n\n${f.a}`).join("\n\n")}`;
}
function takeawaysBlock(bullets: string[]): string {
  return `**Key takeaways**\n\n${bullets.map((b) => `- ${b}`).join("\n")}`;
}

export interface GeoApplyContext {
  draft: Draft;
  onSectionSave: (sectionId: string, content_md: string, createVersion?: boolean) => Promise<void>;
  onOpeningSave: (next: string) => Promise<void>;
  onTitleSave: (sectionId: string, title: string) => Promise<void>;
}

function readSource(draft: Draft, sectionId: string): string {
  if (sectionId === OPENING) return draft.outline?.opening_hook ?? "";
  return draft.sections.find((s) => s.id === sectionId)?.content_md ?? "";
}

/**
 * Resolve where an issue's fix should land: `{ sectionId, before, target }`.
 * Some backend findings (citations, factual_density) carry a `target` claim but
 * NO `section_id`, so a naive `readSource(draft, "")` returns "" and every fix
 * no-ops. When the id doesn't name a real section, locate by the target (shared
 * matcher), falling back to the first section so a fix always lands somewhere
 * visible. `target` is returned only when it's a literal substring of `before`
 * (so a scoped `before.replace(target, …)` works); otherwise it's null and the
 * caller edits the whole resolved section body.
 */
function locate(
  draft: Draft,
  issue: Issue,
): { sectionId: string; before: string; target: string | null } {
  const { sectionId, target } = issue;
  const known = sectionId === OPENING || draft.sections.some((s) => s.id === sectionId);
  const resolved = known
    ? sectionId
    : ((target ? sectionForTarget(target, draft.sections) : null) ??
      draft.sections[0]?.id ??
      sectionId);
  const before = readSource(draft, resolved);
  return { sectionId: resolved, before, target: target && before.includes(target) ? target : null };
}

/** Route a persisted value to the right field (body / title / opening). */
export function makeGeoSave(
  ctx: GeoApplyContext,
): (sectionId: string, value: string, field?: AppliedField) => Promise<void> {
  const { onSectionSave, onOpeningSave, onTitleSave } = ctx;
  return async (sectionId, value, field) => {
    if (field === "title") await onTitleSave(sectionId, value);
    else if (field === "opening" || sectionId === OPENING) await onOpeningSave(value);
    else await onSectionSave(sectionId, value);
  };
}

export function makeGeoApply(
  ctx: GeoApplyContext,
): (
  issue: Issue,
  action: IssueAction,
  input?: string,
  opts?: { persist?: boolean },
) => Promise<Applied | null> {
  const { draft } = ctx;
  const save = makeGeoSave(ctx);
  const openingField = (sectionId: string): AppliedField =>
    sectionId === OPENING ? "opening" : "content";

  return async (
    issue: Issue,
    action: IssueAction,
    input?: string,
    opts?: { persist?: boolean },
  ): Promise<Applied | null> => {
    const persist = opts?.persist !== false;
    // Resolve the real section even when the finding tagged a target but no id.
    const { sectionId, before, target } = locate(draft, issue);
    const field = openingField(sectionId);

    // Rewrite an image's empty alt text in place (![](url) → ![alt](url)).
    const applyAlt = async (alt: string): Promise<Applied | null> => {
      if (!target || !alt.trim()) return null;
      const withAlt = target.replace(/!\[\s*\]/, `![${alt.trim()}]`);
      if (withAlt === target) return null;
      const after = before.replace(target, withAlt);
      if (persist) await save(sectionId, after, field);
      return { sectionId, before, after, highlight: withAlt, field };
    };

    switch (action) {
      case "ai_fix": {
        // Section titles live on the section, not in the body — edit the title.
        if (issue.fixKind === "question_heading") {
          const section = draft.sections.find((s) => s.id === sectionId);
          if (!section) return null;
          const { text } = await inlineEdit(draft.id, {
            text: section.title,
            action: "custom",
            instruction:
              "Rephrase this blog section heading as a concise, natural question. Return only the heading text — no markdown, no surrounding quotes.",
          });
          const nextTitle = text
            .trim()
            .replace(/^#+\s*/, "")
            .replace(/^["']|["']$/g, "");
          if (!nextTitle || nextTitle === section.title) return null;
          if (persist) await save(sectionId, nextTitle, "title");
          return {
            sectionId,
            before: section.title,
            after: nextTitle,
            highlight: nextTitle,
            field: "title",
          };
        }
        const source = target ?? before;
        if (!source.trim()) return null;
        const instruction =
          INSTRUCTION[issue.fixKind ?? ""] ??
          `Revise this passage to resolve the issue: ${issue.title}. ${issue.why} Keep the author's voice and all substance; return only the revised passage, no heading.`;
        const { text } = await inlineEdit(draft.id, {
          text: source,
          action: "custom",
          instruction,
        });
        const fixed = text.trim();
        if (!fixed) return null;
        const after = target ? before.replace(target, fixed) : fixed;
        if (persist) await save(sectionId, after, field);
        return { sectionId, before, after, highlight: fixed, field };
      }

      case "manual_fix": {
        if (!input) return null;
        const after = target ? before.replace(target, input) : input;
        if (persist) await save(sectionId, after, field);
        return { sectionId, before, after, highlight: input, field };
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
        if (!woven) return null;
        const after = target ? before.replace(target, woven) : woven;
        if (persist) await save(sectionId, after, field);
        return { sectionId, before, after, highlight: woven, field };
      }

      case "generate": {
        if (issue.fixKind === "alt_text") return applyAlt(await geoAlt(draft.id, target ?? ""));
        const block = await generateBlock(draft, issue);
        if (block === null) return null;
        return applyBlock(draft, issue, block, save, persist);
      }

      case "write_own": {
        if (!input) return null;
        if (issue.fixKind === "alt_text") return applyAlt(input);
        return applyBlock(draft, issue, input, save, persist);
      }

      case "cite_source": {
        if (!input) return null;
        const source = target ?? before;
        if (!source.trim()) return null;
        const { text } = await inlineEdit(draft.id, {
          text: source,
          action: "custom",
          instruction: `Weave a citation to this source into the passage, naturally and in the author's voice. Source: "${input}". If the source is a URL, hyperlink the single most relevant phrase to it in Markdown ([phrase](url)); otherwise attribute the supporting claim to the source inline. Invent nothing and keep all existing substance. Return only the revised passage.`,
        });
        const fixed = text.trim();
        if (!fixed) return null;
        const after = target ? before.replace(target, fixed) : fixed;
        if (persist) await save(sectionId, after, field);
        return { sectionId, before, after, highlight: fixed, field };
      }

      case "quote_source": {
        if (!target) return null;
        const refs = await listReferences(draft.id);
        const ref = refs[0];
        if (!ref) return null;
        const quotes = await geoQuotes(draft.id, ref.id);
        const quote = quotes[0];
        if (!quote) return null;
        const passage = await geoCite(draft.id, {
          section_id: sectionId,
          target,
          reference_id: ref.id,
          quote,
        });
        const fixed = passage.trim();
        const after = before.replace(target, fixed);
        if (persist) await save(sectionId, after, field);
        return { sectionId, before, after, highlight: fixed, field };
      }

      case "dedupe": {
        if (!target) return null;
        const deduped = dedupeOpeningBlock(target);
        const after = before.replace(target, deduped);
        if (after === before) return null;
        if (persist) await save(sectionId, after, field);
        return { sectionId, before, after, highlight: deduped, field };
      }

      case "dismiss":
        return { sectionId, before: "", after: "", field };

      default:
        return null;
    }
  };
}

async function generateBlock(draft: Draft, issue: Issue): Promise<string | null> {
  switch (issue.fixKind) {
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
      return table || null;
    }
    case "definitional": {
      const opener = await generateOpener(draft.id);
      return opener || null;
    }
    default:
      return null;
  }
}

async function applyBlock(
  draft: Draft,
  issue: Issue,
  block: string,
  save: (sectionId: string, next: string, field?: AppliedField) => Promise<void>,
  persist = true,
): Promise<Applied | null> {
  const clean = block.trim();
  if (!clean) return null;

  if (issue.fixKind === "takeaways") {
    const first = draft.sections[0];
    if (!first) return null;
    const base = first.content_md;
    const after = `${clean}\n\n${base.trim()}`;
    if (persist) await save(first.id, after, "content");
    return { sectionId: first.id, before: base, after, highlight: clean, field: "content" };
  }

  if (issue.fixKind === "definitional") {
    const existing = (draft.outline?.opening_hook ?? "").trim();
    const after = existing ? `${clean}\n\n${existing}` : clean;
    if (persist) await save("opening", after, "opening");
    return { sectionId: "opening", before: existing, after, highlight: clean, field: "opening" };
  }

  // faq → the end of the article (last section); comparison_table → its own
  // section. Resolve the host explicitly and append to ITS body, since a faq
  // coverage finding carries no section_id (issue.sectionId would be empty).
  const host =
    issue.fixKind === "faq"
      ? draft.sections[draft.sections.length - 1]
      : (draft.sections.find((s) => s.id === issue.sectionId) ??
        draft.sections[draft.sections.length - 1]);
  if (!host) return null;
  const base = host.content_md;
  const after = `${base.trim()}\n\n${clean}`;
  if (persist) await save(host.id, after, "content");
  return { sectionId: host.id, before: base, after, highlight: clean, field: "content" };
}
