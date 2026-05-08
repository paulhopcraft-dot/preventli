/**
 * Worker Health Timeline — E2E (WHT-10)
 *
 * Verifies the end-to-end flow introduced in Wave 0–3:
 *   1. Partner workspace → click worker name → /workers/:id → Health History
 *      timeline renders → click each of the three event types and land on the
 *      correct deep link.
 *   2. Employer case detail → click worker name in the case header → /workers/:id.
 *
 * Test fixtures (verified live in prod):
 *   - Daryl Thompson (workerId fcb4ba7a-8443-484c-bdd3-6e1ff20e3355) at
 *     org-alpine-health — has 1 assessment + 1 case + 1 certificate (the only
 *     worker with all three event types).
 *
 * Login: workbetter@workbetter.net.au / workbetter123 (partner role).
 * Override via E2E_PARTNER_EMAIL / E2E_PARTNER_PASSWORD env vars.
 *
 * Running: requires a server reachable at PLAYWRIGHT_BASE_URL (defaults to
 * https://gpnet3.onrender.com per playwright.config.ts) AND the test fixtures
 * to be present in that database. Run with:
 *   npx playwright test tests/e2e/worker-health-timeline.spec.ts
 *
 * @critical
 */

import { test, expect, type Page } from "@playwright/test";
import { TEST_TIMEOUTS } from "./fixtures/test-data";

const PARTNER_CREDENTIALS = {
  email: process.env.E2E_PARTNER_EMAIL ?? "workbetter@workbetter.net.au",
  password: process.env.E2E_PARTNER_PASSWORD ?? "workbetter123",
} as const;

// Daryl Thompson — only worker with all three event types
const DARYL_WORKER_ID = "fcb4ba7a-8443-484c-bdd3-6e1ff20e3355";
const DARYL_NAME = "Daryl Thompson";

const URL_RE = {
  workerProfile: /\/workers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  assessment: /\/assessments\/[^/?]+$/,
  case: /\/employer\/case\/[^/?]+$/,
  caseTreatmentTab: /\/employer\/case\/[^/?]+\?tab=treatment$/,
};

/**
 * Partner login helper. The shared auth.fixture defaults to admin creds; we
 * need a partner user, so we log in directly.
 */
async function loginAsPartner(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded", timeout: TEST_TIMEOUTS.long });

  await page.locator('input[type="email"]').fill(PARTNER_CREDENTIALS.email);
  await page.locator('input[type="password"]').fill(PARTNER_CREDENTIALS.password);
  await page.locator('button[type="submit"]').click();

  // Partner role redirects to /partner/clients (see AuthContext.tsx:117–118)
  await page.waitForURL(/\/partner\/clients/, { timeout: TEST_TIMEOUTS.long });
}

test.describe("Worker Health Timeline", { tag: "@critical" }, () => {
  test("partner → click worker name → timeline → each event type deep-links correctly", async ({ page }) => {
    await loginAsPartner(page);

    // Partner cases table renders the worker-link buttons with
    // data-testid={`worker-link-${caseId}`}. Find Daryl by name.
    const darylLink = page
      .locator('[data-testid^="worker-link-"]', { hasText: DARYL_NAME })
      .first();
    await expect(darylLink).toBeVisible({ timeout: TEST_TIMEOUTS.long });

    await darylLink.click();
    await page.waitForURL(URL_RE.workerProfile, { timeout: TEST_TIMEOUTS.long });
    expect(page.url()).toContain(`/workers/${DARYL_WORKER_ID}`);

    // Health History card heading from WorkerProfile.tsx
    await expect(page.getByText("Health History").first()).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

    // The timeline rows are role="button" (see WorkerHealthTimeline.tsx).
    // We expect at least 3 events for Daryl (1 assessment + 1 case + 1 certificate).
    const timelineNodes = page.locator('[role="button"]:has(p.text-sm.font-medium)');
    await expect.poll(async () => timelineNodes.count(), { timeout: TEST_TIMEOUTS.medium }).toBeGreaterThanOrEqual(3);

    // Helper to navigate back to the worker profile for the next assertion
    async function returnToProfile(): Promise<void> {
      await page.goBack();
      await page.waitForURL(URL_RE.workerProfile, { timeout: TEST_TIMEOUTS.medium });
      await expect(page.getByText("Health History").first()).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
    }

    // Helper: click the first timeline node whose deep link matches a regex.
    // We probe by clicking each row and checking the resulting URL — cheaper
    // than parsing the DOM for href since these are role="button" not <a>.
    async function clickEventMatching(urlPattern: RegExp): Promise<void> {
      const count = await timelineNodes.count();
      for (let i = 0; i < count; i++) {
        await timelineNodes.nth(i).click();
        try {
          await page.waitForURL(urlPattern, { timeout: 3000 });
          return; // matched
        } catch {
          // didn't match — go back and try the next one
          await page.goBack();
          await page.waitForURL(URL_RE.workerProfile, { timeout: TEST_TIMEOUTS.medium });
        }
      }
      throw new Error(`No timeline node deep-linked to ${urlPattern}`);
    }

    // --- assessment event → /assessments/:id ---
    await clickEventMatching(URL_RE.assessment);
    expect(page.url()).toMatch(URL_RE.assessment);
    await returnToProfile();

    // --- case event → /employer/case/:id (without ?tab=treatment) ---
    await clickEventMatching(URL_RE.case);
    expect(page.url()).toMatch(URL_RE.case);
    expect(page.url()).not.toContain("tab=treatment");
    await returnToProfile();

    // --- certificate event → /employer/case/:id?tab=treatment ---
    await clickEventMatching(URL_RE.caseTreatmentTab);
    expect(page.url()).toMatch(URL_RE.caseTreatmentTab);
  });

  test("employer case detail → click worker name → /workers/:id", async ({ page }) => {
    await loginAsPartner(page);

    // Open the first case in the partner table — clicking the row (not the
    // worker-link button) goes through openCase() → JWT-swap → employer case
    // detail page (see PartnerWorkspace.tsx).
    const firstCaseRow = page.locator('[data-testid^="case-row-"]').first();
    await expect(firstCaseRow).toBeVisible({ timeout: TEST_TIMEOUTS.long });

    // Click an empty cell to trigger row's onClick (worker-link button has
    // stopPropagation). The summary column is a safe target.
    await firstCaseRow.locator("td").nth(2).click();
    await page.waitForURL(/\/employer\/case\//, { timeout: TEST_TIMEOUTS.long });

    // The worker name in the case header is now a <Link> to /workers/:id
    // (see EmployerCaseDetailPage.tsx CommandCentre + header). Click whichever
    // is visible (the card header on desktop or the truncated header).
    const workerNameLink = page.locator('a[href^="/workers/"]').first();
    await expect(workerNameLink).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

    await workerNameLink.click();
    await page.waitForURL(URL_RE.workerProfile, { timeout: TEST_TIMEOUTS.long });
    expect(page.url()).toMatch(URL_RE.workerProfile);
  });

  test("graceful degradation: workers without workerId render as plain text", async ({ page }) => {
    // Defensive check — post-Wave-0 every case should have workerId populated,
    // so this is documenting the fallback rather than asserting it triggers.
    // Skip if all cases are clickable (the expected state in current data).
    await loginAsPartner(page);

    const allCaseRows = page.locator('[data-testid^="case-row-"]');
    await expect(allCaseRows.first()).toBeVisible({ timeout: TEST_TIMEOUTS.long });

    const totalCases = await allCaseRows.count();
    const linkedWorkers = await page.locator('[data-testid^="worker-link-"]').count();

    if (totalCases === linkedWorkers) {
      test.skip(true, "All cases have workerId populated — fallback path not exercised in current data");
      return;
    }

    // Otherwise, at least one row should render the worker name as plain text
    // (a <span> with title="Worker profile unavailable", see PartnerWorkspace.tsx:365).
    const fallbackSpan = page.locator('span[title="Worker profile unavailable"]').first();
    await expect(fallbackSpan).toBeVisible();
  });
});
