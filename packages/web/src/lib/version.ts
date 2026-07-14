/**
 * Build identity, baked into the bundle at build time (see scripts/cf-prepare.sh).
 * The git SHA is the signal that answers "am I running the right version?" —
 * it changes every deploy, unlike the semver. Locally these env vars are unset,
 * so the badge reads "dev".
 */
// Default the version from package.json so EVERY build path shows the right
// number — a plain `pnpm build` that doesn't export VITE_APP_VERSION no longer
// falls back to a stale hardcoded string. The build scripts still override
// VITE_APP_VERSION / VITE_GIT_SHA for an exact tag + sha.
import { version as pkgVersion } from "../../package.json";

export interface BuildInfo {
  version: string;
  sha: string;
  builtAt: string;
}

export const BUILD: BuildInfo = {
  version: import.meta.env.VITE_APP_VERSION || pkgVersion,
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
