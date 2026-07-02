import type { PublishConfig } from "./publish";

/**
 * A one-time, site-level GEO setup checklist — the "invisible failure" items
 * that live at the site level, not per post: AI-crawler access, server-side
 * rendering, schema, author/E-E-A-T, and freshness cadence. Written as Markdown
 * to drop into the writer's repo (GEO-SETUP.md). Per-post levers live in the
 * GEO panel; this covers what the panel can't see.
 */
export function buildGeoSetup(config?: Pick<PublishConfig, "owner" | "repo">): string {
  const repo =
    config?.owner && config?.repo ? `\`${config.owner}/${config.repo}\`` : "your blog repo";
  return `# GEO site setup — one-time checklist

Do these once for ${repo}. They're the site-level GEO signals the per-post GEO
panel can't check, and the ones that fail invisibly.

## 1. Let AI crawlers in (most common silent failure)

Add these agents to \`robots.txt\` (allow, don't block):

\`\`\`
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: PerplexityBot
User-agent: Claude-SearchBot
User-agent: Google-Extended
Allow: /
\`\`\`

Then confirm your CDN/WAF (Cloudflare, Fastly, etc.) isn't silently blocking
them — this is the most common invisible GEO failure. Check the access logs for
these user-agents actually reaching your origin.

## 2. Serve content server-side

AI crawlers don't run JavaScript. If your post text only appears after a client
render, it's invisible to them. Confirm "View source" shows the full article
HTML — for a static-site generator (Hugo/Jekyll) this is automatic.

## 3. Keep the structured data

BlogForge's HTML export already embeds Article + FAQPage JSON-LD and a visible
"Updated {month}" line. If you publish the Markdown through an SSG instead,
make sure your template emits the same \`Article\`/\`FAQPage\` JSON-LD and keeps
the \`date\` / \`lastmod\` front-matter fields BlogForge writes.

## 4. Real author, real credentials (E-E-A-T)

Attach a real author bio with actual credentials and first-hand experience to
every post. Every engine's quality system weighs this; a byline with no
identity behind it is a weak signal.

## 5. Freshness cadence

- Keep \`lastmod\` / \`dateModified\` accurate — bump it only on a real edit.
- Refresh cornerstone/pillar posts on a real cadence; Perplexity in particular
  decays content after 60–90 days without updates.
- Add a visible "Updated [month/year]" note when you refresh.

---

*Re-check your own top buyer prompts across ChatGPT, Perplexity, and Google AI
Mode periodically — citation patterns shift month to month.*
`;
}
