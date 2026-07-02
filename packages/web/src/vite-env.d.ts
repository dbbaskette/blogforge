/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** App semver, injected at build (falls back to package.json default). */
  readonly VITE_APP_VERSION?: string;
  /** Short git SHA of the built commit — the deploy-identity signal. */
  readonly VITE_GIT_SHA?: string;
  /** UTC build timestamp (ISO-8601). */
  readonly VITE_BUILD_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
