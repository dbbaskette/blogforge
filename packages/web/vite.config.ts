import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7881,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:7880",
      // LinkedIn connector. Mounted into the main API by default, so it's
      // same-origin on :7880. If you run it standalone (`pencraft
      // serve-linkedin` with PENCRAFT_MOUNT_LINKEDIN=false), repoint this
      // to http://127.0.0.1:7890.
      "/linkedin": "http://127.0.0.1:7880",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
