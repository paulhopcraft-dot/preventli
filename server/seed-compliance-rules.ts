/**
 * Seed compliance rules into the database.
 * Run from Windows: npx tsx server/seed-compliance-rules.ts
 *
 * Idempotent — uses upsert on ruleCode so safe to re-run.
 */

import { db } from './db';
import { complianceRules } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { InsertComplianceRule } from '@shared/schema';

type RuleSeed = Omit<InsertComplianceRule, 'id' | 'createdAt' | 'updatedAt'>;

const RULES: any[] = [
  // ── Existing rules ───────────────────────────────────────────────────────
  {
    ruleCode: 'CERT_CURRENT',
    name: 'Current Medical Certificate',
    description: 'A valid medical certificate must be on file for all workers currently off work.',
    checkType: 'certificate',
    severity: 'high',
    recommendedAction: 'Contact the treating GP to request an updated certificate.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's112' }],
    evaluationLogic: { triggerCondition: 'Worker is off work and certificate has expired or is within 7 days of expiry.' },
    isActive: true,
  },
  {
    ruleCode: 'RTW_PLAN_10WK',
    name: 'RTW Plan Within 10 Weeks',
    description: 'A return-to-work plan must be developed within 10 weeks for serious injuries.',
    checkType: 'rtw_plan',
    severity: 'high',
    recommendedAction: 'Initiate RTW planning immediately with the worker and treating practitioner.',
    documentReferences: [{ source: 'WorkSafe RTW Code of Practice', section: 'cl.4.3' }],
    evaluationLogic: { triggerCondition: 'Case is 10+ weeks old and RTW plan status is not_planned or unknown.' },
    isActive: true,
  },
  {
    ruleCode: 'FILE_REVIEW_8WK',
    name: '8-Week File Review',
    description: 'Case files must be reviewed at least every 8 weeks.',
    checkType: 'file_review',
    severity: 'medium',
    recommendedAction: 'Schedule a case review covering medical, RTW, and compliance status.',
    documentReferences: [{ source: 'WorkSafe Claims Manual', section: 'ch.7' }],
    evaluationLogic: { triggerCondition: 'Case has not been updated in more than 49 days.' },
    isActive: true,
  },
  {
    ruleCode: 'PAYMENT_STEPDOWN',
    name: '13-Week Payment Step-Down',
    description: 'Weekly compensation reduces to 80% of PIAWE after 13 weeks.',
    checkType: 'payment',
    severity: 'medium',
    recommendedAction: 'Verify payment calculations have been adjusted and notify the worker in writing.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's114' }],
    evaluationLogic: { triggerCondition: 'Worker is off work and 13+ weeks post-injury.' },
    isActive: true,
  },
  {
    ruleCode: 'CENTRELINK_CLEARANCE',
    name: 'Centrelink Clearance',
    description: 'Centrelink clearance must be obtained before processing ongoing payments for workers off work >4 weeks.',
    checkType: 'payment',
    severity: 'medium',
    recommendedAction: 'Submit a Centrelink clearance request and document the outcome.',
    documentReferences: [{ source: 'Social Security Act 1991', section: 'general' }],
    evaluationLogic: { triggerCondition: 'Worker is off work for more than 4 weeks with no documented Centrelink clearance.' },
    isActive: true,
  },
  {
    ruleCode: 'SUITABLE_DUTIES',
    name: 'Suitable Duties Provision',
    description: 'Employers must provide suitable duties to injured workers where available.',
    checkType: 'other',
    severity: 'high',
    recommendedAction: 'Conduct a workplace assessment to identify duties matching current worker capacity.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's82-83' }],
    evaluationLogic: { triggerCondition: 'Worker has documented functional capacity but is still fully off work with no suitable duties offer.' },
    isActive: true,
  },
  {
    ruleCode: 'RTW_OBLIGATIONS',
    name: 'RTW Cooperation Obligations',
    description: 'Both employer and worker must actively cooperate in the return-to-work process.',
    checkType: 'rtw_plan',
    severity: 'high',
    recommendedAction: 'Engage all parties to assess RTW cooperation and update case records.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's82-83' }],
    evaluationLogic: { triggerCondition: 'RTW plan is failing or there has been no case activity for more than 30 days.' },
    isActive: true,
  },

  // ── Phase 7 — New rules ──────────────────────────────────────────────────
  {
    ruleCode: 'CLAIM_NOTIFICATION',
    name: 'Claim Notification Within 10 Business Days',
    description: 'Employer must notify the insurer of a work-related injury within 10 business days of becoming aware.',
    checkType: 'other',
    severity: 'high',
    recommendedAction: 'Submit claim notification to the insurer immediately via the WorkSafe employer portal. Document the reason for any delay.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's25' }],
    evaluationLogic: { triggerCondition: 'Case is more than 10 business days old without confirmed insurer notification.' },
    isActive: true,
  },
  {
    ruleCode: 'PAYMENT_STEPDOWN_52WK',
    name: '52-Week Payment Step-Down to 75% PIAWE',
    description: 'Weekly compensation reduces to 75% of pre-injury average weekly earnings after 52 weeks off work.',
    checkType: 'payment',
    severity: 'high',
    recommendedAction: 'Verify payment rate has been adjusted to 75% PIAWE. Issue written notice to the worker at least 2 weeks before the step-down date.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's114(2)' }],
    evaluationLogic: { triggerCondition: 'Worker is off work and within 2 weeks of, or past, the 52-week threshold.' },
    isActive: true,
  },
  {
    ruleCode: 'PAYMENT_STEPDOWN_130WK',
    name: '130-Week Payment Cessation',
    description: 'Weekly compensation generally ceases after 130 weeks unless the worker meets the serious injury threshold.',
    checkType: 'payment',
    severity: 'critical',
    recommendedAction: 'Urgently assess serious injury threshold eligibility. If no extension applies, issue formal cessation notice at least 4 weeks before payments end.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's114(3)' }],
    evaluationLogic: { triggerCondition: 'Worker is off work and within 4 weeks of, or past, the 130-week threshold.' },
    isActive: true,
  },
  {
    ruleCode: 'TERMINATION_ELIGIBILITY',
    name: 'Termination Protection (52-Week)',
    description: 'An employer cannot terminate a worker solely because of their work injury during the first 52 weeks of incapacity.',
    checkType: 'other',
    severity: 'critical',
    recommendedAction: 'Halt any termination process immediately. Seek legal advice before taking further action.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's242' }],
    evaluationLogic: { triggerCondition: 'A termination process has been initiated while the worker is within the 52-week protected period.' },
    isActive: true,
  },
  {
    ruleCode: 'IME_FREQUENCY',
    name: 'IME Frequency Limit (12 Weeks)',
    description: 'Independent Medical Examinations must not be scheduled more frequently than every 12 weeks without exceptional justification.',
    checkType: 'other',
    severity: 'medium',
    recommendedAction: 'Review IME scheduling. If a shorter interval is required, document exceptional clinical or legal circumstances.',
    documentReferences: [
      { source: 'WorkSafe Claims Manual', section: 'ch.12' },
      { source: 'WIRC Act 2013', section: 's126' },
    ],
    evaluationLogic: { triggerCondition: 'Two or more IMEs have been recorded less than 12 weeks apart.' },
    isActive: true,
  },
  {
    ruleCode: 'PROVISIONAL_PAYMENTS',
    name: 'Provisional Payments Within 10 Business Days',
    description: 'Provisional weekly payments must commence within 10 business days of receiving a WorkCover claim.',
    checkType: 'payment',
    severity: 'high',
    recommendedAction: 'Initiate provisional payments immediately. If rejecting the claim, document clear grounds and notify WorkSafe.',
    documentReferences: [{ source: 'WIRC Act 2013', section: 's267A' }],
    evaluationLogic: { triggerCondition: 'Worker is off work and more than 10 business days have elapsed since claim receipt.' },
    isActive: true,
  },
];

async function seedComplianceRules(): Promise<void> {
  console.log('[seed-compliance] Upserting compliance rules...');

  for (const rule of RULES) {
    const existing = await db.select({ id: complianceRules.id })
      .from(complianceRules)
      .where(eq(complianceRules.ruleCode, rule.ruleCode))
      .limit(1);

    if (existing.length > 0) {
      await db.update(complianceRules)
        .set({
          name: rule.name,
          description: rule.description,
          checkType: rule.checkType,
          severity: rule.severity,
          recommendedAction: rule.recommendedAction,
          documentReferences: rule.documentReferences,
          evaluationLogic: rule.evaluationLogic,
          isActive: rule.isActive,
        } as any)
        .where(eq(complianceRules.ruleCode, rule.ruleCode));
      console.log(`  updated: ${rule.ruleCode}`);
    } else {
      await db.insert(complianceRules).values(rule as any);
      console.log(`  inserted: ${rule.ruleCode}`);
    }
  }

  console.log('[seed-compliance] Done.');
  process.exit(0);
}

seedComplianceRules().catch(err => {
  console.error('[seed-compliance] Error:', err);
  process.exit(1);
});
