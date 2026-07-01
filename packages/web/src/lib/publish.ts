/**
 * "Publish to GitHub" — turn a finished draft into a file in the writer's blog
 * repo. The GitHub login is read-only (no repo scope, no stored token), so we
 * don't create the commit server-side; instead we drop the writer into
 * GitHub's own new-file editor at the right path with the markdown in hand
 * (and on the clipboard as a fallback). One click, no extra permissions.
 */
export type FrontmatterPreset = "hugo" | "jekyll" | "plain";

export interface PublishConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Directory in the repo where posts live (no leading/trailing slash needed). */
  dir: string;
  preset: FrontmatterPreset;
}

export const DEFAULT_PUBLISH_CONFIG: PublishConfig = {
  owner: "",
  repo: "",
  branch: "main",
  dir: "content/posts",
  preset: "hugo",
};

const KEY = "bf.publish.config";

export function loadPublishConfig(): PublishConfig {
  try {
    const raw = localStorage.getItem(KEY);
    return raw
      ? { ...DEFAULT_PUBLISH_CONFIG, ...(JSON.parse(raw) as Partial<PublishConfig>) }
      : { ...DEFAULT_PUBLISH_CONFIG };
  } catch {
    return { ...DEFAULT_PUBLISH_CONFIG };
  }
}

export function savePublishConfig(config: PublishConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* storage disabled — the form just won't remember next time */
  }
}

/** URL-safe, filesystem-safe slug from a post title. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\da-z]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return s || "post";
}

/** Jekyll's `_posts` convention needs a `YYYY-MM-DD-` prefix; others don't. */
export function buildFilename(preset: FrontmatterPreset, slug: string, isoDate: string): string {
  return preset === "jekyll" ? `${isoDate}-${slug}.md` : `${slug}.md`;
}

// GitHub's ?value= prefill silently drops content past a few KB; stay well
// under so short posts land pre-filled and long ones fall back to clipboard.
const VALUE_LIMIT = 6000;

/**
 * Build the GitHub "create new file" URL: the directory lives in the path and
 * the filename is a query param (GitHub's documented prefill shape). `content`
 * is prefilled only when it's short enough to survive.
 */
export function newFileUrl(config: PublishConfig, filename: string, content: string): string {
  const dir = config.dir.replace(/^\/+|\/+$/g, "");
  const base = `https://github.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(
    config.repo,
  )}/new/${encodeURIComponent(config.branch)}${dir ? `/${dir}` : ""}`;
  const params = new URLSearchParams({ filename });
  if (content.length <= VALUE_LIMIT) params.set("value", content);
  return `${base}?${params.toString()}`;
}

/** Did the URL manage to prefill the content, or must the writer paste it? */
export function willPrefillContent(content: string): boolean {
  return content.length <= VALUE_LIMIT;
}
