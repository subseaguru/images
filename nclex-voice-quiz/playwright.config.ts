import { defineConfig, devices } from "@playwright/test";

// One fixed port: the server holds shared state (attempts, settings, sources), so the suite runs
// on a single worker against a data directory that global-setup wipes before every run.
const PORT = 3417;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The data directory is wiped in the same command, because Playwright starts the web server
    // before globalSetup runs - a directory emptied afterwards would already be loaded in memory.
    command:
      "node -e \"require('node:fs').rmSync('.playwright-tmp/data',{recursive:true,force:true})\" && node dist/src/server/index.js",
    url: `${BASE_URL}/api/health`,
    env: {
      PORT: String(PORT),
      HOST: "127.0.0.1",
      DATA_DIR: ".playwright-tmp/data",
      SEED_DIR: "tests/fixtures/seed",
      ANTHROPIC_API_KEY: "",
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
