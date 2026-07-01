/**
 * Render INLINE Markdown emphasis (bold/italic/code) to safe HTML for headings
 * — section titles, the outline sidebar, the reading-preview title. A pasted
 * `## **ROTATE**` then shows a bold "ROTATE" instead of the literal `**`, and
 * the stored document keeps its markdown verbatim (so exports stay faithful).
 *
 * Safe by construction: the text is HTML-escaped first, so only the emphasis
 * tags we add can produce markup — a title can't inject raw HTML.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function inlineMarkdownToHtml(text: string): string {
  let h = escapeHtml(text);
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  h = h.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  h = h.replace(/(^|[^\w])_([^_]+)_(?![\w])/g, "$1<em>$2</em>");
  return h;
}
