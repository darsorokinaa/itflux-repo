const { defineConfig, devices } = require("@playwright/test");
const path = require("path");

const minutes = Number(process.env.TEST_MINUTES || 60);
const longSessionMs = Math.max(minutes, 1) * 60 * 1000 + 5 * 60 * 1000;

module.exports = defineConfig({
  testDir: path.join(__dirname, "tests"),
  testMatch: "**/*.spec.js",
  timeout: 3 * 60 * 1000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    ignoreHTTPSErrors: false,
    locale: "ru-RU",
  },
  projects: [
    {
      name: "local-chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
      },
    },
  ],
  metadata: {
    longSessionTimeoutMs: longSessionMs,
  },
});
