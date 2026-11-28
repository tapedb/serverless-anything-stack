// Playwright config for e2e tests against a deployed Preview, staging or
// production. Copy to the application root. APP_URL is the deployment's URL;
// without it the tests run against the local dev server.
import { defineConfig, devices } from "@playwright/test";

const local = !process.env.APP_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0, // a pass on retry is a fail: see references/testing.md
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:8787",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: local ? { command: "npm run dev", url: "http://localhost:8787", reuseExistingServer: true, timeout: 120_000 } : undefined,
});
