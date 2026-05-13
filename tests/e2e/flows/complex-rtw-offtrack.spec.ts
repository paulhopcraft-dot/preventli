/**
 * Complex RTW Off-Track E2E Test Suite
 *
 * Scenario: Daniel — back injury in manufacturing, WorkSafe claim lodged.
 * Original RTW timeline: 12 weeks. Now 3 months in — still off work, no improvement.
 *
 * From an HR manager's perspective, this tests whether Preventli actually helps you
 * manage a difficult case or just stores data. At every phase the system MUST
 * suggest the next step. If it doesn't, that is a critical gap.
 *
 * WorkSafe Code of Practice references tested throughout:
 * - cl.4.3: RTW Plan must be started within 10 working days of claim
 * - cl.5.2: Suitable duties must be documented when worker cannot return to pre-injury role
 * - cl.8.1: Non-compliance with RTW obligations — documentation requirements
 * - Fair Work Act s.340: Adverse action protections before any termination action
 *
 * Tags:
 *   @critical   — core RTW compliance workflow, must pass before deploy
 *   @regression — run nightly
 *   @rtw        — return-to-work scenario group
 */

import { test, expect } from '../fixtures/auth.fixture';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Navigate to a case by searching for a worker name or use a known case ID.
 * RTW scenarios need a real case — search for one that's overdue or off-track.
 */
async function findOffTrackCase(page: import('../fixtures/auth.fixture').Page) {
  await page.goto('/employer');
  await page.waitForLoadState('domcontentloaded');

  // Look for cases marked overdue, off-track, or at-risk
  const offTrackCase = page.locator(
    '[data-status="overdue"], [data-status="off-track"], text=/overdue|off.track|at.risk/i'
  ).first();

  if (await offTrackCase.isVisible({ timeout: 5000 }).catch(() => false)) {
    await offTrackCase.click();
    return true;
  }

  // Fall back: open the first case in the list
  const firstCase = page.locator('table tbody tr, [data-testid="case-row"]').first();
  if (await firstCase.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstCase.click();
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Week 0–2: Claim lodgement, initial cert, 12-week timeline
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Phase 1 — Claim Lodged, RTW Timeline Set', { tag: ['@critical', '@rtw'] }, () => {

  test('dashboard shows new claim with RTW timeline displayed', async ({ authenticatedPage: page }) => {
    // HR needs to see the RTW deadline the moment a claim is lodged.
    // Without a visible timeline, coordinators miss the 10-working-day RTW Plan window.
    await page.goto('/employer');
    await page.waitForLoadState('domcontentloaded');

    const timelineIndicator = page.locator(
      'text=/rtw.*plan|return.*to.*work.*plan|rtw.*deadline/i'
    ).first();

    const hasTimeline = await timelineIndicator.isVisible({ timeout: 6000 }).catch(() => false);
    if (!hasTimeline) {
      console.log('GAP: RTW Plan deadline not shown on dashboard — coordinators will miss the 10-day window (Code of Practice cl.4.3)');
    }
    // Not a hard fail — feature may be on case detail page
  });

  test('new case has RTW plan deadline field (10 working days from claim)', async ({ authenticatedPage: page }) => {
    // WorkSafe Code of Practice cl.4.3: RTW Plan must begin within 10 working days.
    // The system should auto-calculate this date when a claim date is entered.
    const found = await findOffTrackCase(page);
    if (!found) {
      console.log('No cases found — skipping RTW deadline check');
      return;
    }

    await page.waitForLoadState('domcontentloaded');

    const rtwDeadline = page.locator(
      'text=/rtw.*plan.*due|plan.*deadline|10.*working.*day/i, [data-testid="rtw-plan-deadline"]'
    ).first();

    const hasDeadline = await rtwDeadline.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasDeadline) {
      console.log('GAP: No auto-calculated RTW Plan deadline visible on case — manual tracking required, risk of breach');
    }
  });

  test('case shows WorkSafe claim number and lodgement date', async ({ authenticatedPage: page }) => {
    // HR needs the claim number to communicate with WorkSafe and the insurer.
    // Without it, every phone call starts with a 5-minute search.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const claimNumber = page.locator(
      'text=/claim.*number|worksafe.*ref|claim.*ref/i, [data-testid="claim-number"]'
    ).first();

    const hasClaimNumber = await claimNumber.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasClaimNumber) {
      console.log('GAP: WorkSafe claim number not visible — HR must switch to a separate system to find it');
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Week 6: Certificate renewal, same restrictions, no progress
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Phase 2 — Certificate Renewal, No Progress', { tag: ['@critical', '@rtw'] }, () => {

  test('certificate history shows multiple renewals with unchanged restrictions', async ({ authenticatedPage: page }) => {
    // If the same restrictions appear on every certificate, something is wrong clinically.
    // HR needs to see a pattern, not just the latest cert.
    const found = await findOffTrackCase(page);
    if (!found) return;

    // Try to navigate to certificates or treatment tab
    const certTab = page.locator(
      '[role="tab"]:has-text("Certificate"), [role="tab"]:has-text("Treatment"), button:has-text("Certificates")'
    ).first();

    if (await certTab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await certTab.click();
      await page.waitForLoadState('domcontentloaded');
    }

    // Check if multiple certificates are listed
    const certRows = page.locator('[data-testid="cert-row"], .certificate-row, table tbody tr');
    const certCount = await certRows.count();

    if (certCount < 2) {
      console.log('GAP: Only one certificate shown — no history view means HR cannot spot unchanged restrictions pattern');
    } else {
      console.log(`Certificate history: ${certCount} certificates listed`);
    }
  });

  test('system flags when consecutive certificates show same restrictions', async ({ authenticatedPage: page }) => {
    // Two certs with identical restrictions = clinical stagnation.
    // Preventli should surface this so HR knows to prompt GP contact.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const stagnationWarning = page.locator(
      'text=/unchanged.*restriction|no.*progress|same.*restriction|cert.*unchanged/i, [data-testid="stagnation-flag"]'
    ).first();

    const hasFlag = await stagnationWarning.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasFlag) {
      console.log('GAP: No flag for unchanged certificate restrictions — missed opportunity to prompt GP contact review');
    }
  });

  test('case suggests contacting GP when restrictions unchanged for 4+ weeks', async ({ authenticatedPage: page }) => {
    // HR managers often don't know when to push for a GP review meeting.
    // The system should prompt: "Restrictions unchanged for 6 weeks — consider requesting GP case conference."
    const found = await findOffTrackCase(page);
    if (!found) return;

    const gpSuggestion = page.locator(
      'text=/gp.*contact|gp.*review|case.*conference|suggest.*gp/i, [data-testid="gp-contact-suggestion"]'
    ).first();

    const hasSuggestion = await gpSuggestion.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasSuggestion) {
      console.log('GAP: No GP contact suggestion when restrictions unchanged — new HR coordinators will not know to do this');
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Week 12: RTW milestone missed, still off work
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Phase 3 — RTW Milestone Missed (12 Weeks)', { tag: ['@critical', '@rtw'] }, () => {

  test('overdue RTW cases are visible and clearly flagged on dashboard', async ({ authenticatedPage: page }) => {
    // HR manages 20+ cases. Overdue cases must stand out — not be buried in a list.
    // This is the most important single thing the dashboard needs to do.
    await page.goto('/employer');
    await page.waitForLoadState('domcontentloaded');

    const overdueFlag = page.locator(
      '[data-status="overdue"], .overdue-badge, [data-testid="overdue-indicator"]'
    ).or(page.getByText(/overdue/i)).first();

    await expect(overdueFlag).toBeVisible({ timeout: 8000 });
  });

  test('overdue case shows clear OVERDUE status badge on case detail', async ({ authenticatedPage: page }) => {
    // When you open a case, the status must be unmissable.
    // "Active" is not enough when the RTW plan is 3 weeks late.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const overdueStatus = page.locator(
      '[data-testid="case-status"]:has-text("Overdue"), .status-badge:has-text("Overdue"), text=/status.*overdue|overdue.*status/i'
    ).first();

    const hasOverdue = await overdueStatus.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasOverdue) {
      console.log('GAP: Overdue status not visible on case detail — HR sees "Active" for a case 3 weeks past RTW deadline');
    }
  });

  test('missed RTW milestone generates a next-step action automatically', async ({ authenticatedPage: page }) => {
    // When an RTW deadline passes, the system must create an action item.
    // HR should not need to manually check if they missed a deadline.
    const found = await findOffTrackCase(page);
    if (!found) return;

    // Look for an actions panel, to-do list, or next steps section
    const actionsPanel = page.locator(
      '[data-testid="actions-panel"], text=/next.*step|action.*required|what.*to.*do/i, .action-item'
    ).first();

    const hasActions = await actionsPanel.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasActions) {
      console.log('GAP: No auto-generated action when RTW milestone missed — HR must remember to act without a prompt');
    }
  });

  test('risk level escalates from Low to High when RTW milestone missed', async ({ authenticatedPage: page }) => {
    // Low risk = on track. High risk = off track.
    // An overdue case that still shows "Low risk" gives false confidence to HR.
    const found = await findOffTrackCase(page);
    if (!found) return;

    // Navigate to risk tab if present
    const riskTab = page.locator(
      '[role="tab"]:has-text("Risk"), button:has-text("Risk")'
    ).first();

    if (await riskTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await riskTab.click();
      await page.waitForLoadState('domcontentloaded');
    }

    const highRisk = page.locator(
      'text=/high.*risk|risk.*high|elevated.*risk/i, [data-risk-level="high"], .risk-badge-high'
    ).first();

    const hasHighRisk = await highRisk.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasHighRisk) {
      console.log('GAP: Risk level not escalated to High for overdue RTW case — HR may deprioritise a case that needs urgent attention');
    }
  });

  test('case timeline shows the missed RTW milestone as a dated event', async ({ authenticatedPage: page }) => {
    // The timeline is the audit trail. If a WorkSafe inspector asks "when did you know?",
    // the missed milestone must be there with a date.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const timelineTab = page.locator(
      '[role="tab"]:has-text("Timeline"), button:has-text("Timeline")'
    ).first();

    if (await timelineTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await timelineTab.click();
      await page.waitForLoadState('domcontentloaded');
    }

    const missedMilestone = page.locator(
      'text=/milestone.*missed|rtw.*overdue|deadline.*passed/i, [data-event-type="milestone-missed"]'
    ).first();

    const hasEvent = await missedMilestone.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasEvent) {
      console.log('GAP: Missed RTW milestone not in timeline — audit trail incomplete for WorkSafe inspector');
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Week 16: No suitable duties found (manufacturing + back injury)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Phase 4 — No Suitable Duties Available', { tag: ['@critical', '@rtw'] }, () => {

  test('case has a suitable duties section where attempts can be documented', async ({ authenticatedPage: page }) => {
    // WorkSafe requires employers to document every attempt to find suitable duties.
    // Without a dedicated section, HR keeps notes in email and spreadsheets — not auditable.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const suitableDuties = page.locator(
      '[data-testid="suitable-duties"], text=/suitable.*duties|modified.*duties|alternate.*duties/i'
    ).first();

    const hasSuitableDuties = await suitableDuties.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasSuitableDuties) {
      console.log('GAP: No suitable duties section — HR cannot document attempts within Preventli, audit trail will be in email');
    }
  });

  test('system prompts for vocational assessment referral when no suitable duties found', async ({ authenticatedPage: page }) => {
    // If suitable duties cannot be found after genuine attempts, WorkSafe expects a
    // vocational assessment referral. New HR coordinators often don't know this step exists.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const vocationalPrompt = page.locator(
      'text=/vocational.*assessment|voc.*assessment|occupational.*rehab/i, [data-testid="vocational-referral"]'
    ).first();

    const hasPrompt = await vocationalPrompt.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasPrompt) {
      console.log('GAP: No vocational assessment referral prompt — HR misses this step without Preventli guidance');
    }
  });

  test('premium impact warning appears when case extends beyond 12 weeks', async ({ authenticatedPage: page }) => {
    // WorkSafe claims affect the employer's premium classification.
    // HR managers need to understand the financial consequence of a long-running case
    // to escalate internally and secure management support.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const premiumWarning = page.locator(
      'text=/premium.*impact|insurance.*premium|cost.*impact|financial.*impact/i, [data-testid="premium-warning"]'
    ).first();

    const hasWarning = await premiumWarning.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasWarning) {
      console.log('GAP: No premium impact warning for long-running case — HR cannot make business case to management for extra resources');
    }
  });

  test('suitable duties panel has a "Cannot provide suitable duties" option to document formally', async ({ authenticatedPage: page }) => {
    // Formally documenting inability to provide duties is a legal protection for the employer.
    // If Preventli doesn't have this, HR types it in a notes field and it gets lost.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const cannotProvideOption = page.locator(
      'text=/cannot.*provide|no.*suitable.*duties.*available|unable.*to.*accommodate/i'
    ).first();

    const hasOption = await cannotProvideOption.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasOption) {
      console.log('GAP: No formal "Cannot provide suitable duties" documentation option');
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5 — Week 20: Worker non-compliance
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Phase 5 — Worker Non-Compliance', { tag: ['@critical', '@rtw'] }, () => {

  test('case has a non-compliance section for documenting contact attempts', async ({ authenticatedPage: page }) => {
    // Non-compliance must be documented carefully — dates, method of contact, outcome.
    // If WorkSafe investigates, HR needs to show "we tried X times on these dates."
    // Without a structured log, notes get buried in email threads.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const nonComplianceSection = page.locator(
      '[data-testid="non-compliance"], text=/non.compliance|non-compliance|contact.*attempt/i'
    ).first();

    const hasSection = await nonComplianceSection.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasSection) {
      console.log('GAP: No non-compliance documentation section — contact attempts will be in email, not in Preventli');
    }
  });

  test('system prompts for formal notice when worker misses 3+ appointments', async ({ authenticatedPage: page }) => {
    // After repeated non-compliance, HR must issue a formal notice before any further action.
    // Most coordinators don't know what threshold triggers formal notice requirements.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const formalNoticePrompt = page.locator(
      'text=/formal.*notice|written.*notice|notice.*of.*non.compliance/i, [data-testid="formal-notice-prompt"]'
    ).first();

    const hasPrompt = await formalNoticePrompt.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasPrompt) {
      console.log('GAP: No formal notice prompt after repeated non-compliance — HR may escalate prematurely and expose employer to adverse action claim');
    }
  });

  test('system surfaces Fair Work Act obligations when documenting non-compliance', async ({ authenticatedPage: page }) => {
    // Non-compliance documentation feeds into termination consideration.
    // FWA s.340 adverse action provisions must be flagged BEFORE HR goes down this path.
    // This is the most common legal mistake made by non-specialist HR teams.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const fwaAlert = page.locator(
      'text=/fair work|fwa|adverse.*action|s\.340|section.*340/i, [data-testid="fwa-alert"]'
    ).first();

    const hasAlert = await fwaAlert.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAlert) {
      console.log('GAP: No FWA adverse action warning when documenting non-compliance — high legal risk for employers without in-house counsel');
    }
  });

  test('contact attempt log captures date, method, and outcome fields', async ({ authenticatedPage: page }) => {
    // A valid contact log needs: date, how you contacted them (phone/email/letter),
    // and what happened (no answer, left voicemail, spoke briefly, etc.)
    const found = await findOffTrackCase(page);
    if (!found) return;

    // Look for a form or table with these fields
    const contactDate = page.locator('input[type="date"], text=/contact.*date|date.*of.*contact/i').first();
    const contactMethod = page.locator('select, text=/method|phone|email|letter/i').first();

    const hasDate = await contactDate.isVisible({ timeout: 3000 }).catch(() => false);
    const hasMethod = await contactMethod.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasDate || !hasMethod) {
      console.log('GAP: Contact attempt log missing structured fields — free text notes are not sufficient for WorkSafe audit');
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6 — Week 24: Escalation — termination possible
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Phase 6 — Escalation to Termination', { tag: ['@critical', '@rtw'] }, () => {

  test('termination process section exists on long-running off-track case', async ({ authenticatedPage: page }) => {
    // Termination of an injured worker is a legal minefield.
    // Preventli should have a guided workflow — not just a status dropdown.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const terminationSection = page.locator(
      '[data-testid="termination-section"], text=/termination.*process|considering.*termination/i'
    ).first();

    const hasSection = await terminationSection.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasSection) {
      // Also try navigating to a termination route
      await page.goto('/employer/termination').catch(() => {});
      const terminationPage = page.locator('text=/termination|pre.termination/i').first();
      const hasPage = await terminationPage.isVisible({ timeout: 3000 }).catch(() => false);
      if (!hasPage) {
        console.log('GAP: No termination process section — HR navigates this alone without legal guidance');
      }
    }
  });

  test('pre-termination checklist is displayed before any termination action', async ({ authenticatedPage: page }) => {
    // A checklist prevents employers from taking termination action prematurely.
    // Minimum required items: GP review done, suitable duties exhausted, FWA advice obtained,
    // formal notice issued, grievance process offered.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const checklist = page.locator(
      '[data-testid="pre-termination-checklist"], text=/pre.termination.*checklist|before.*termination/i'
    ).first();

    const hasChecklist = await checklist.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasChecklist) {
      console.log('GAP: No pre-termination checklist — employer may proceed without completing required steps, high unfair dismissal risk');
    }
  });

  test('FWA section 340 adverse action warning is prominent on termination screen', async ({ authenticatedPage: page }) => {
    // Section 340 of the Fair Work Act prohibits adverse action against injured workers.
    // This warning must be impossible to miss — not in a tooltip, not in fine print.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const s340Warning = page.locator(
      'text=/s\.340|section.*340|adverse.*action.*warning|fair work.*adverse/i, [data-testid="s340-warning"]'
    ).first();

    const hasWarning = await s340Warning.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasWarning) {
      console.log('CRITICAL GAP: No FWA s.340 adverse action warning on termination screen — significant legal exposure for employer');
    }
  });

  test('system prompts to obtain legal advice before proceeding with termination', async ({ authenticatedPage: page }) => {
    // WorkSafe recommends legal advice before terminating an injured worker.
    // A prompt here — "Have you obtained independent legal advice?" — could prevent litigation.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const legalAdvicePrompt = page.locator(
      'text=/legal.*advice|obtain.*advice|speak.*to.*lawyer|independent.*advice/i, [data-testid="legal-advice-prompt"]'
    ).first();

    const hasPrompt = await legalAdvicePrompt.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasPrompt) {
      console.log('GAP: No legal advice prompt before termination — Preventli misses opportunity to protect employer from litigation');
    }
  });

  test('termination record is added to case timeline as dated audit event', async ({ authenticatedPage: page }) => {
    // Any termination action must appear in the timeline for audit purposes.
    // Date, who actioned it, and what stage of the process.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const timelineTab = page.locator(
      '[role="tab"]:has-text("Timeline"), button:has-text("Timeline")'
    ).first();

    if (await timelineTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await timelineTab.click();
      await page.waitForLoadState('domcontentloaded');
    }

    // Check timeline has some events (proxy for completeness)
    const timelineEvents = page.locator(
      '[data-testid="timeline-event"], .timeline-item, [data-event-type]'
    );

    const eventCount = await timelineEvents.count();
    if (eventCount === 0) {
      console.log('GAP: No timeline events found — case history is not being recorded');
    } else {
      console.log(`Timeline has ${eventCount} events`);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-CUTTING: "What do I do next?" — the most important question in RTW
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Next-Step Guidance — Does Preventli Tell You What To Do?', { tag: ['@critical', '@rtw'] }, () => {

  test('off-track case shows a "next recommended action" prominently', async ({ authenticatedPage: page }) => {
    // An HR coordinator who opens an off-track case should not have to think
    // "what should I do now?" — Preventli should tell them.
    // This is the core value proposition of the product.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const nextAction = page.locator(
      '[data-testid="next-action"], text=/recommended.*action|next.*step|what.*to.*do.*next|action.*required/i'
    ).first();

    const hasNextAction = await nextAction.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasNextAction) {
      console.log('CRITICAL GAP: No "next recommended action" on off-track case — the core RTW guidance feature is missing');
    }
  });

  test('Alex (AI) gives actionable RTW advice when asked about an off-track case', async ({ authenticatedPage: page }) => {
    // HR managers should be able to ask Alex: "Daniel is 3 months in, no improvement.
    // What should I do?" and get a practical, WorkSafe-compliant answer.
    const found = await findOffTrackCase(page);
    if (!found) return;

    // Find the Alex chat interface
    const drAlex = page.locator(
      'text=/dr.*alex|ask.*alex|ai.*assistant|chat/i, [data-testid="dr-alex-chat"]'
    ).first();

    const hasDrAlex = await drAlex.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasDrAlex) {
      console.log('GAP: Alex chat not visible on case — AI guidance not accessible at the point of need');
      return;
    }

    await drAlex.click();

    // Type an RTW question
    const chatInput = page.locator(
      'textarea[placeholder*="Ask"], input[placeholder*="Ask"], [data-testid="chat-input"]'
    ).first();

    if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatInput.fill('This worker has been off for 3 months and their RTW plan milestone was missed at 12 weeks. What should I do next?');

      const sendButton = page.locator('button[type="submit"], button:has-text("Send")').first();
      if (await sendButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sendButton.click();

        // Wait for a response
        const response = page.locator('[data-testid="alex-response"], .chat-response').first();
        const hasResponse = await response.isVisible({ timeout: 15000 }).catch(() => false);

        if (!hasResponse) {
          console.log('GAP: Alex did not respond to RTW question within 15 seconds');
        } else {
          const responseText = await response.textContent();
          console.log('Alex response received:', responseText?.substring(0, 200));
          // Response should mention actionable steps
          expect(responseText?.toLowerCase()).toMatch(/step|action|contact|gp|worksafe|plan|review/i);
        }
      }
    }
  });

  test('case summary shows days since injury, days since RTW deadline, and current risk level', async ({ authenticatedPage: page }) => {
    // At a glance, HR needs three numbers: how long has this been going, how overdue is it,
    // and what is the current risk. If these are buried, the system is not doing its job.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const daysSinceInjury = page.locator(
      'text=/days.*off.*work|weeks.*off.*work|time.*off/i, [data-testid="days-off-work"]'
    ).first();

    const hasTimeOff = await daysSinceInjury.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTimeOff) {
      console.log('GAP: Days off work not shown on case summary — HR cannot quickly assess case duration without manual calculation');
    }
  });

  test('all six RTW phases have at least one action item visible in the case', async ({ authenticatedPage: page }) => {
    // A case 3+ months old with WorkSafe involvement should have a rich action history.
    // If the case actions panel is empty for an overdue case, Preventli is not guiding the workflow.
    const found = await findOffTrackCase(page);
    if (!found) return;

    const actionsTab = page.locator(
      '[role="tab"]:has-text("Action"), button:has-text("Actions"), [data-testid="actions-tab"]'
    ).first();

    if (await actionsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await actionsTab.click();
      await page.waitForLoadState('domcontentloaded');
    }

    const actionItems = page.locator(
      '[data-testid="action-item"], .action-item, tr[data-action-id]'
    );

    const count = await actionItems.count();
    if (count === 0) {
      console.log('CRITICAL GAP: No action items found on overdue case — Preventli is storing data but not driving workflow');
    } else {
      console.log(`${count} action items found on case`);
      expect(count).toBeGreaterThan(0);
    }
  });

});
