import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7881,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:7880",
      // The LinkedIn connector runs as its own process on :7890.
      "/linkedin": "http://127.0.0.1:7890",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
