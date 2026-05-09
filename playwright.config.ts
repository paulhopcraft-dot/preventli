import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Configuration
 *
 * Supports wave-based test tagging via TEST_GREP environment variable:
 *   TEST_GREP="@smoke" npx playwright test       # Fast feedback tests (~2 min)
 *   TEST_GREP="@critical" npx playwright test    # Core flow tests (~10 min)
 *   TEST_GREP="@regression" npx playwright test  # Full regression suite
 *   TEST_GREP="@performance" npx playwright test # Performance benchmarks
 *
 * Tag tests using test.describe or test annotations:
 *   test.describe('@smoke Login Tests', () => { ... });
 *   test('@critical should create case', async () => { ... });
 */
// Connect to Paul's existing Chrome on Windows via CDP when available
// Run Chrome with: chrome.exe --remote-debugging-port=9222
// From WSL the host is accessible at the Windows host IP (192.168.0.140)
const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://192.168.0.140:9222";
const USE_CDP = process.env.USE_CDP === "1";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60 * 1000,
  retries: 0,

  grep: process.env.TEST_GREP ? new RegExp(process.env.TEST_GREP) : undefined,

  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://app.preventli.ai",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // When USE_CDP=1, attach to Paul's running Chrome instead of launching a new one
    ...(USE_CDP ? { cdpEndpoint: CDP_ENDPOINT } : {}),
  },

  // Skip the dev server when testing against Render or CDP
  ...(process.env.CI || USE_CDP || process.env.PLAYWRIGHT_BASE_URL?.startsWith("https")
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: "http://localhost:5000",
          reuseExistingServer: true,
          timeout: 120 * 1000,
        },
      }),

  projects: [
    {
      name: "chromium",
      use: USE_CDP
        ? {} // CDP mode — use the connected browser as-is
        : { ...devices["Desktop Chrome"] },
    },
  ],
});
