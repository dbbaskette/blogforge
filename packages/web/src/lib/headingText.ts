/**
 * Strip inline-Markdown emphasis from text meant to render as a plain-text
 * HEADING (section titles, the draft title, the outline sidebar). These are
 * not markdown-rendered, so a pasted `## **ROTATE**` would otherwise show the
 * literal `**`. Emphasis in a heading is almost always paste noise, so we drop
 * the markers rather than render bold. Bodies are unaffected — they render as
 * real Markdown elsewhere.
 */
export function stripInlineEmphasis(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1") // `code`
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
    .replace(/__([^_]+)__/g, "$1") // __bold__
    .replace(/\*([^*]+)\*/g, "$1") // *italic*
    .replace(/(^|[^\w])_([^_]+)_(?![\w])/g, "$1$2") // _italic_ (not snake_case)
    .replace(/\*\*/g, "") // stray/unbalanced bold markers
    .replace(/`/g, "") // stray backticks
    .trim();
}
