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
