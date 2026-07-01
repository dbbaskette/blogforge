import { inlineMarkdownToHtml } from "../../lib/inlineMarkdown";

/**
 * Render a heading's inline Markdown (bold/italic/code) as formatted text
 * instead of showing literal `**`. Safe: the source is HTML-escaped before the
 * emphasis tags are applied. Use inside a heading element, e.g.
 * `<h3><InlineMarkdown text={section.title} /></h3>`.
 */
export function InlineMarkdown({ text }: { text: string }): JSX.Element {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: input is HTML-escaped in inlineMarkdownToHtml
  return <span dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(text) }} />;
}
