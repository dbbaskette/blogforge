import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The app version (VITE_APP_VERSION) is injected at build time from
// packages/web/package.json by the build scripts (scripts/serve-local.sh,
// scripts/cf-prepare.sh) so the UI badge always matches the shipped code.
// Bump the web bundle AND the API together with scripts/version.sh.
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
