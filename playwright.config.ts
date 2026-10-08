import { defineConfig } from "@playwright/test";

const PORT = 3100;
// Set E2E_BASE_URL to test a deployment instead of a local dev server.
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: { baseURL: remote ?? `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: remote ? undefined : {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
