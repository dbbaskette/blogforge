import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Version single-source: bake packages/web/package.json's version into the
// bundle so the UI badge always matches the shipped code, on every build path
// (dev, serve-local, CI, cf-prepare). cf-prepare.sh may still override
// VITE_APP_VERSION to stamp a specific deploy. Bump the web bundle AND the API
// together with scripts/version.sh — never edit the version by hand.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8"),
) as { version: string };
process.env.VITE_APP_VERSION ||= pkg.version;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7881,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:7880",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
