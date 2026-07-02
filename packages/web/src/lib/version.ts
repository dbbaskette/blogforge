/**
 * Build identity, baked into the bundle at build time (see scripts/cf-prepare.sh).
 * The git SHA is the signal that answers "am I running the right version?" —
 * it changes every deploy, unlike the semver. Locally these env vars are unset,
 * so the badge reads "dev".
 */
export interface BuildInfo {
  version: string;
  sha: string;
  builtAt: string;
}

export const BUILD: BuildInfo = {
  version: import.meta.env.VITE_APP_VERSION || "0.1.0",
  sha: import.meta.env.VITE_GIT_SHA || "dev",
  builtAt: import.meta.env.VITE_BUILD_TIME || "",
};

/** Short, glanceable label: `v0.1.0 · 49bd6cb` (or `v0.1.0 · dev` locally). */
export function versionLabel(b: BuildInfo = BUILD): string {
  return `v${b.version} · ${b.sha}`;
}

/** Tooltip detail: when the running bundle was built. */
export function versionTitle(b: BuildInfo = BUILD): string {
  if (b.sha === "dev") return "Local dev build";
  return b.builtAt ? `Built ${b.builtAt}` : `Commit ${b.sha}`;
}
