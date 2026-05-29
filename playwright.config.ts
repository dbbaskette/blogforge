import { defineConfig } from "@playwright/test";

const REPO = "/Users/dbbaskette/Projects/BlogForge";
const E2E_DRAFTS = "/tmp/blogforge-e2e-drafts";
const E2E_PACKS = "/tmp/blogforge-e2e-packs";
const E2E_CFG = "/tmp/blogforge-e2e-myvoice-config.yaml";
const E2E_MOCK_JSON = "/tmp/blogforge-e2e-mock-outline.json";

// The mock outline JSON is written to a file by e2e-setup.sh, then read at launch time
// via command substitution to avoid shell quoting issues with embedded JSON.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:7881", trace: "on-first-retry" },
  webServer: [
    {
      // e2e-setup.sh: rsync packs, write YAML config, write mock JSON file.
      // Then export BLOGFORGE_MOCK_OUTPUT_JSON from the file and start the backend.
      command: [
        `bash ${REPO}/scripts/e2e-setup.sh`,
        `&&`,
        `BLOGFORGE_TEST_PROVIDER=mock`,
        `BLOGFORGE_MOCK_OUTPUT="Some section body content."`,
        `BLOGFORGE_DRAFTS_ROOT=${E2E_DRAFTS}`,
        `MYVOICE_PACKS_ROOT=${E2E_PACKS}`,
        `MYVOICE_CONFIG_PATH=${E2E_CFG}`,
        `BLOGFORGE_MOCK_OUTPUT_JSON="$(cat ${E2E_MOCK_JSON})"`,
        `${REPO}/.venv/bin/blogforge serve --no-browser --dev --port 7880`,
      ].join(" "),
      url: "http://127.0.0.1:7880/api/drafts",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `cd ${REPO}/packages/web && pnpm dev --port 7881 --host 127.0.0.1`,
      port: 7881,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
  ],
});
