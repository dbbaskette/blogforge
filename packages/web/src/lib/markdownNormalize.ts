/**
 * Normalize pasted / imported prose into clean Markdown. Content authored in a
 * real editor pastes fine, but content from Word, Google Docs, or a PDF brings
 * non-Markdown artifacts — bullet glyphs, non-breaking spaces, "1)" numbering —
 * that render as bare paragraphs. This fixes the mechanical ones deterministically
 * (it does NOT invent headings; that stays the writer's call via `##`).
 */

// Line-leading bullet glyphs that word processors emit instead of "- ".
const BULLET_GLYPHS = "•‣◦▪▫●○∙·";
const BULLET_RE = new RegExp(`^([ \\t]*)[${BULLET_GLYPHS}][ \\t]+`, "gm");
// "1)" / "2)" style numbering → Markdown "1." / "2." (line-leading only).
const NUMBERED_RE = /^([ \t]*)(\d+)\)[ \t]+/gm;
// Non-breaking space (Word/Docs) → plain space.
const NBSP_RE = /\u00a0/g;

export function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n") // CRLF / lone CR → LF
    .replace(NBSP_RE, " ")
    .replace(BULLET_RE, "$1- ") // • bullet → Markdown "- "
    .replace(NUMBERED_RE, "$1$2. "); // 1) → 1.
}

/** True when normalizing would actually change the text — used to decide
 * whether to intercept a paste (leave clean pastes to the browser default). */
export function needsNormalizing(text: string): boolean {
  return normalizeMarkdown(text) !== text;
}
