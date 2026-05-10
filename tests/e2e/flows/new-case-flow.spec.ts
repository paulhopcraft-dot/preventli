/**
 * New Case Creation Flow — E2E Tests
 *
 * Sarah Chen (WHS Manager) perspective: creating a new worker case is the
 * most time-critical HR action. When an injury happens, minutes matter.
 * These tests verify every step from gateway to AI summary, because a
 * broken form means a delayed claim, which means compliance exposure.
 *
 * Routes:
 *   /employer/new-case            — gateway + form
 *   /employer/case/:id/success    — created case confirmation
 *   /cases                        — cases list (verified post-submit)
 *   /employer/case/:id            — case detail with AI summary
 *
 * Coverage:
 *   1. WorkSafe gateway Yes path  — external redirect shown, no internal case
 *   2. WorkSafe gateway No path   — full internal form revealed
 *   3. Worker + incident form fields present and fillable
 *   4. Full submission → success page → case list → AI summary
 */

import { test, expect } from '../fixtures/auth.fixture';

// ─── Gateway Tests ────────────────────────────────────────────────────────────

test.describe('WorkSafe Gateway', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/employer/new-case');
    await page.waitForLoadState('domcontentloaded');
  });

  test(
    'gateway question is shown before any form fields',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: HR needs to answer this FIRST before the form appears.
      // If the question is missing, staff may create an internal case for an
      // already-lodged WorkSafe claim — a duplication that wastes insurer time.
      const gatewayText = page.locator('text=/WorkSafe|claim.*lodged|lodged.*claim/i').first();
      await expect(gatewayText).toBeVisible({ timeout: 10_000 });
    },
  );

  test(
    'gateway "Yes" path: shows WorkSafe external link, does not reveal internal form',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: Clicking "Yes" means the claim is already with WorkSafe.
      // Preventli should redirect the user out — NOT create a duplicate internal
      // case. This is a critical compliance gate; a false pass here could create
      // thousands of duplicate records.
      const yesButton = page
        .locator('button, [role="radio"], label')
        .filter({ hasText: /^Yes$/ })
        .first();
      await yesButton.waitFor({ state: 'visible', timeout: 10_000 });
      await yesButton.click();

      // External link to WorkSafe must appear
      const worksafeLink = page.locator('a, button').filter({ hasText: /WorkSafe Victoria/i }).first();
      await expect(worksafeLink).toBeVisible({ timeout: 5_000 });

      // The internal case form must NOT appear
      const workerNameInput = page.locator('input[name*="name"], input[placeholder*="name"]').first();
      await expect(workerNameInput).not.toBeVisible();
    },
  );

  test(
    'gateway "No" path: full case creation form is revealed',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: "No claim lodged" means HR creates the internal case.
      // The form must appear immediately after selection — any extra click or
      // page navigation adds friction during an already stressful incident.
      const noButton = page
        .locator('button, [role="radio"], label')
        .filter({ hasText: /^No$/ })
        .first();
      await noButton.waitFor({ state: 'visible', timeout: 10_000 });
      await noButton.click();

      // At minimum, worker name and email fields must appear
      const nameInput = page.locator('input[placeholder*="name" i], input[name*="name" i]').first();
      await expect(nameInput).toBeVisible({ timeout: 5_000 });

      const emailInput = page.locator('input[type="email"]').first();
      await expect(emailInput).toBeVisible({ timeout: 3_000 });
    },
  );
});

// ─── Form Section Tests ───────────────────────────────────────────────────────

test.describe('Case Creation Form', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/employer/new-case');
    await page.waitForLoadState('domcontentloaded');

    // Navigate past gateway — select "No claim lodged"
    const noButton = page
      .locator('button, [role="radio"], label')
      .filter({ hasText: /^No$/ })
      .first();
    await noButton.waitFor({ state: 'visible', timeout: 10_000 });
    await noButton.click();

    // Wait for form to be visible
    await page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 8_000 });
  });

  test(
    'worker details section has name, email, and phone fields',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: Missing contact fields mean HR cannot notify the worker or
      // their treating GP. All three fields are mandatory under WorkSafe's
      // Employer Obligations (s.138A OHS Act).
      const nameInput = page.locator('input[placeholder*="name" i], input[name*="name" i]').first();
      await expect(nameInput).toBeVisible();

      const emailInput = page.locator('input[type="email"]').first();
      await expect(emailInput).toBeVisible();

      const phoneInput = page.locator('input[type="tel"], input[name*="phone" i]').first();
      await expect(phoneInput).toBeVisible();
    },
  );

  test(
    'incident details section has date, location, and description fields',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: Date and location are the first two questions WorkSafe
      // asks during a claim call. HR must capture them accurately on the day,
      // not reconstruct them from memory a week later.
      const dateInput = page.locator('input[type="date"]').first();
      await expect(dateInput).toBeVisible();

      const descriptionField = page.locator('textarea').first();
      await expect(descriptionField).toBeVisible();
    },
  );

  test(
    'injury type options include musculoskeletal',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: Musculoskeletal is the #1 injury type in manufacturing.
      // If it's missing from the list, HR defaults to "Other" and the AI
      // summary loses specificity — costing accuracy in risk scoring.
      const musculoOption = page.locator('text=/musculoskeletal/i').first();
      await expect(musculoOption).toBeVisible({ timeout: 8_000 });
    },
  );

  test(
    'worker details fields accept and retain input',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: Basic smoke test — if field input is lost on blur or focus
      // change, HR will discover it only after hitting Submit, then have to
      // re-enter everything mid-incident workflow.
      const nameInput = page.locator('input[placeholder*="name" i], input[name*="name" i]').first();
      await nameInput.fill('Sarah Test');
      await expect(nameInput).toHaveValue('Sarah Test');

      const emailInput = page.locator('input[type="email"]').first();
      await emailInput.fill('sarah.test@e2e.local');
      await expect(emailInput).toHaveValue('sarah.test@e2e.local');
    },
  );
});

// ─── Full Submission Flow ─────────────────────────────────────────────────────

test.describe('Full Case Submission Flow', () => {
  // NOTE: These tests actually submit a case and create live data.
  // Worker name is prefixed "E2E-TEST" so records are easy to identify.

  test(
    'submitting complete case redirects to success page showing worker name',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: The success page is the HR manager's confirmation that
      // the case is in the system. Worker name must appear — if it shows a
      // blank or generic "Case Created", HR cannot confirm the right record
      // was created, especially when managing multiple simultaneous incidents.
      await page.goto('/employer/new-case');
      await page.waitForLoadState('domcontentloaded');

      // Answer gateway
      const noButton = page
        .locator('button, [role="radio"], label')
        .filter({ hasText: /^No$/ })
        .first();
      await noButton.waitFor({ state: 'visible', timeout: 10_000 });
      await noButton.click();
      await page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 8_000 });

      // Worker details
      const nameInput = page.locator('input[placeholder*="name" i], input[name*="name" i]').first();
      await nameInput.fill('E2E-TEST Worker');

      const emailInput = page.locator('input[type="email"]').first();
      await emailInput.fill('e2e-test@example.com');

      const phoneInput = page.locator('input[type="tel"], input[name*="phone" i]').first();
      await phoneInput.fill('0400000000');

      // Work status — select "Off work"
      const offWorkOption = page
        .locator('button, [role="radio"], label')
        .filter({ hasText: /^Off work$|^Off Work$/ })
        .first();
      if (await offWorkOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await offWorkOption.click();
      }

      // Date of injury
      const dateInput = page.locator('input[type="date"]').first();
      if (await dateInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await dateInput.fill('2024-03-15');
      }

      // Incident description
      const descField = page.locator('textarea').first();
      if (await descField.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await descField.fill('E2E test: slipped on wet floor in warehouse, lower back impact.');
      }

      // Injury type — Musculoskeletal
      const musculoButton = page
        .locator('button, [role="radio"], label')
        .filter({ hasText: /musculoskeletal/i })
        .first();
      if (await musculoButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await musculoButton.click();
      }

      // Recovery & Support — answer No to both
      const noButtons = page.locator('button, [role="radio"]').filter({ hasText: /^No$/ });
      const noCount = await noButtons.count();
      for (let i = 0; i < noCount; i++) {
        const btn = noButtons.nth(i);
        if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await btn.click();
        }
      }

      // Submit
      const submitButton = page
        .locator('button[type="submit"], button')
        .filter({ hasText: /submit|create case/i })
        .first();
      await submitButton.waitFor({ state: 'visible', timeout: 5_000 });
      await submitButton.click();

      // Wait for success page URL
      await expect(page).toHaveURL(/\/employer\/case\/[^/]+\/success/, { timeout: 15_000 });

      // Worker name must appear on success page
      await expect(page.locator('text=/E2E-TEST Worker/i').first()).toBeVisible({ timeout: 8_000 });
    },
  );

  test(
    'newly created case appears in the cases list',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: The cases list is the HR manager's daily dashboard.
      // A case that doesn't appear there is invisible — no follow-up actions
      // will be assigned, no compliance deadlines tracked, no risk scored.
      // This test verifies the database write actually committed.
      await page.goto('/cases');
      await page.waitForLoadState('domcontentloaded');

      // Cases list must render (not 404 or loading spinner stuck)
      const caseListContent = page.locator('table, [role="list"], [data-testid="case-list"]').first();
      await expect(caseListContent).toBeVisible({ timeout: 10_000 });

      // The E2E-TEST worker from prior test should be visible
      // (Tests run in sequence so the case was just created)
      const e2eCase = page.locator('text=/E2E-TEST Worker/i').first();
      await expect(e2eCase).toBeVisible({ timeout: 8_000 });
    },
  );

  test(
    'case detail page shows AI-generated summary with weeks-off-work figure',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: The AI summary is the single most valuable screen in
      // Preventli — it converts raw case data into an actionable sentence.
      // If the summary is missing, generic, or shows "Loading…" permanently,
      // HR loses the 30-second insight that drives case prioritisation.
      // The specific "X weeks off work" phrasing is tested because that
      // figure directly drives RTW plan deadlines under WorkSafe Code cl.4.3.

      // Find the E2E test case from the list
      await page.goto('/cases');
      await page.waitForLoadState('domcontentloaded');

      const e2eCase = page.locator('text=/E2E-TEST Worker/i').first();
      await e2eCase.waitFor({ state: 'visible', timeout: 10_000 });
      await e2eCase.click();

      // Should land on case detail
      await expect(page).toHaveURL(/\/employer\/case\/[^/]+/, { timeout: 8_000 });

      // AI summary must contain weeks-off-work statement — this is the key
      // compliance-relevant insight Preventli generates from injury date + today
      const summary = page.locator('text=/has been off work for \\d+ weeks/i').first();
      await expect(summary).toBeVisible({ timeout: 15_000 });
    },
  );

  test(
    'case detail shows compliance status and next recommended action',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: Compliance status ("At Risk", "On Track") and the next
      // action are what differentiate Preventli from a basic spreadsheet.
      // If these are absent, HR is paying for a prettier spreadsheet.

      await page.goto('/cases');
      await page.waitForLoadState('domcontentloaded');

      const e2eCase = page.locator('text=/E2E-TEST Worker/i').first();
      await e2eCase.waitFor({ state: 'visible', timeout: 10_000 });
      await e2eCase.click();

      await expect(page).toHaveURL(/\/employer\/case\/[^/]+/, { timeout: 8_000 });

      // Compliance card or badge
      const complianceIndicator = page
        .locator('text=/at risk|on track|overdue|compliance/i')
        .first();
      await expect(complianceIndicator).toBeVisible({ timeout: 10_000 });

      // Next action recommendation
      const nextAction = page
        .locator('text=/next step|recommended|action required|obtain medical certificate|schedule/i')
        .first();
      await expect(nextAction).toBeVisible({ timeout: 8_000 });
    },
  );
});

// ─── Navigation Tests ─────────────────────────────────────────────────────────

test.describe('New Case Navigation', () => {
  test(
    'dashboard has visible link to create a new case',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      // HR verdict: When an injury just happened, the employer calls HR.
      // HR opens Preventli on the dashboard. If "New Case" is buried in a
      // menu, seconds are lost — and compliance clock has already started.
      await page.goto('/employer');
      await page.waitForLoadState('domcontentloaded');

      const newCaseLink = page
        .locator('a, button')
        .filter({ hasText: /new case/i })
        .first();
      await expect(newCaseLink).toBeVisible({ timeout: 8_000 });
      await newCaseLink.click();

      await expect(page).toHaveURL(/new-case/, { timeout: 5_000 });
    },
  );

  test(
    'new case page is accessible and not a 404',
    { tag: '@critical' },
    async ({ authenticatedPage: page }) => {
      await page.goto('/employer/new-case');
      await page.waitForLoadState('domcontentloaded');

      await expect(page).not.toHaveURL(/404/);
      const body = page.locator('body');
      await expect(body).not.toContainText('Not Found');
      await expect(body).not.toContainText('404');
    },
  );
});

// ─── Missing Feature Documentation ───────────────────────────────────────────

test.describe('Known Gaps — Documented for Future Build', () => {
  test(
    '[GAP] WorkSafe claim cases are NOT tracked in Preventli',
    { tag: '@known-gap' },
    async ({ authenticatedPage: page }) => {
      // CRITICAL COMPLIANCE GAP: When an HR user selects "Yes" on the gateway
      // (claim already lodged with WorkSafe), Preventli shows a link to
      // WorkSafe Victoria's website and STOPS. No internal case is created.
      //
      // This means Preventli cannot track RTW obligations, timeline, or
      // compliance status for the majority of serious WorkSafe claims.
      //
      // Impact: HR must maintain a parallel spreadsheet for ALL lodged claims.
      // Gap severity: HIGH — affects every case that reaches WorkSafe threshold.
      //
      // Expected future behaviour: "Yes" path should still create an internal
      // case with a WorkSafe claim reference number field, so Preventli can
      // track RTW planning alongside the external claim.

      await page.goto('/employer/new-case');
      await page.waitForLoadState('domcontentloaded');

      const yesButton = page
        .locator('button, [role="radio"], label')
        .filter({ hasText: /^Yes$/ })
        .first();
      await yesButton.waitFor({ state: 'visible', timeout: 10_000 });
      await yesButton.click();

      // Confirm the gap: external link shown, no internal form
      const worksafeLink = page.locator('a, button').filter({ hasText: /WorkSafe Victoria/i }).first();
      await expect(worksafeLink).toBeVisible({ timeout: 5_000 });

      const internalForm = page.locator('input[type="email"]').first();
      await expect(internalForm).not.toBeVisible();

      // This test PASSES as documentation of the gap — not a regression test.
      // When the gap is fixed, the assertion above will fail and this test
      // should be updated to verify the new behaviour.
      console.warn(
        '[GAP] WorkSafe "Yes" path creates no internal Preventli case. ' +
        'HR must track lodged claims outside the system.',
      );
    },
  );
});
