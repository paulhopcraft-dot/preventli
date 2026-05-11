/**
 * Compliance Rules Engine
 *
 * Evaluates worker cases against compliance rules from:
 * - WIRC Act 2013
 * - WorkSafe Claims Manual
 *
 * Stores results in case_compliance_checks table
 */

import { db } from '../db';
import { complianceRules, caseComplianceChecks, workerCases, medicalCertificates } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import type { WorkerCaseDB, ComplianceRuleDB, CaseComplianceCheckDB, CaseActionType } from '@shared/schema';
import { storage } from '../storage';

export interface ComplianceCheckResult {
  ruleCode: string;
  ruleName: string;
  status: 'compliant' | 'warning' | 'non_compliant';
  severity: string;
  finding: string;
  recommendation: string;
  documentReferences: Array<{ source: string; section: string }>;
  // Phase 2: structured explanation (obligation, legislation, consequence, remedy)
  explanation?: {
    obligation: string;      // Plain English: what you must do
    legislativeRef: string;  // e.g., "WIRC Act 2013, s38"
    consequence: string;     // What happens if non-compliant
    remedy: string;          // Specific action to become compliant
  };
}

export interface CaseComplianceReport {
  caseId: string;
  workerName: string;
  companyName: string;
  overallStatus: 'compliant' | 'warning' | 'non_compliant';
  complianceScore: number; // Percentage (0-100)
  checks: ComplianceCheckResult[];
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  checkedAt: Date;
}

/**
 * Evaluate a single case against all active compliance rules
 */
export async function evaluateCase(caseId: string): Promise<CaseComplianceReport> {
  // Get the case
  const [workerCase] = await db.select()
    .from(workerCases)
    .where(eq(workerCases.id, caseId))
    .limit(1);

  if (!workerCase) {
    throw new Error(`Case ${caseId} not found`);
  }

  // Get all active rules
  const rules = await db.select()
    .from(complianceRules)
    .where(eq(complianceRules.isActive, true));

  const checks: ComplianceCheckResult[] = [];
  let compliantCount = 0;
  let warningCount = 0;
  let nonCompliantCount = 0;

  let criticalIssues = 0;
  let highIssues = 0;
  let mediumIssues = 0;
  let lowIssues = 0;

  const checkedAt = new Date();

  // Evaluate each rule
  for (const rule of rules) {
    const result = await evaluateRule(workerCase, rule);
    checks.push(result);

    // Count by status
    if (result.status === 'compliant') {
      compliantCount++;
    } else if (result.status === 'warning') {
      warningCount++;
    } else {
      nonCompliantCount++;
    }

    // Count by severity if non-compliant
    if (result.status === 'non_compliant') {
      if (rule.severity === 'critical') criticalIssues++;
      else if (rule.severity === 'high') highIssues++;
      else if (rule.severity === 'medium') mediumIssues++;
      else if (rule.severity === 'low') lowIssues++;
    }

    // Create action for non-compliant rules
    let actionId: string | null = null;
    let actionCreated = false;

    if (result.status === 'non_compliant' && result.recommendation) {
      actionId = await createComplianceAction(
        workerCase.id,
        rule.ruleCode,
        result.finding || 'Compliance issue detected',
        result.recommendation
      );
      actionCreated = actionId !== null;
    }

    // Store check result in database
    await db.insert(caseComplianceChecks).values({
      caseId: workerCase.id,
      ruleId: rule.id,
      status: result.status,
      checkedAt,
      finding: result.finding,
      recommendation: result.recommendation,
      actionId,
      actionCreated,
    } as any);
  }

  // Calculate overall status and score
  const totalRules = rules.length;
  const complianceScore = totalRules > 0 ? Math.round((compliantCount / totalRules) * 100) : 100;

  let overallStatus: 'compliant' | 'warning' | 'non_compliant' = 'compliant';
  if (criticalIssues > 0 || highIssues > 0) {
    overallStatus = 'non_compliant';
  } else if (warningCount > 0 || mediumIssues > 0) {
    overallStatus = 'warning';
  }

  // Sync complianceIndicator on worker_cases with live evaluation result
  const indicator = complianceScoreToIndicator(complianceScore, overallStatus);
  try {
    await db.update(workerCases)
      .set({ complianceIndicator: indicator })
      .where(eq(workerCases.id, workerCase.id));
  } catch {
    // Gracefully handle if db.update is unavailable (e.g., in unit tests with mocked db)
  }

  return {
    caseId: workerCase.id,
    workerName: workerCase.workerName,
    companyName: workerCase.company,
    overallStatus,
    complianceScore,
    checks,
    criticalIssues,
    highIssues,
    mediumIssues,
    lowIssues,
    checkedAt,
  };
}

/**
 * Convert a compliance score (0-100) and status into a ComplianceIndicator.
 * This bridges the Rules Engine (System B) output back to the stored
 * complianceIndicator field that users see on dashboards and case lists.
 */
function complianceScoreToIndicator(
  score: number,
  status: 'compliant' | 'warning' | 'non_compliant'
): string {
  if (status === 'non_compliant' || score < 30) return 'Very Low';
  if (score < 50) return 'Low';
  if (status === 'warning' || score < 70) return 'Medium';
  if (score < 90) return 'High';
  return 'Very High';
}

/** Phase 2: Returns a structured explanation for each rule code per the spec table. */
function getExplanationForRule(ruleCode: string): ComplianceCheckResult['explanation'] {
  switch (ruleCode) {
    case 'CERT_CURRENT':
      return {
        obligation: 'A current medical certificate must be on file at all times during an active claim.',
        legislativeRef: 'WIRC Act 2013, s112',
        consequence: 'WorkSafe can issue an improvement notice; the worker cannot be directed to duties without a valid certificate.',
        remedy: 'Contact the treating GP to request an updated certificate. Use the email draft tool to send a request.',
      };
    case 'RTW_PLAN_10WK':
      return {
        obligation: 'For serious injuries, a return-to-work plan must be developed within 10 weeks of the claim.',
        legislativeRef: 'WorkSafe RTW Code of Practice, cl.4.3',
        consequence: 'Non-compliance may trigger a WorkSafe investigation and financial penalties.',
        remedy: "Initiate RTW planning using the worker's current functional capacity and restrictions.",
      };
    case 'FILE_REVIEW_8WK':
      return {
        obligation: 'Case files must be reviewed at least every 8 weeks.',
        legislativeRef: 'WorkSafe Claims Manual, ch.7',
        consequence: 'Stale case files increase the risk of non-compliance and missed intervention opportunities.',
        remedy: 'Schedule a case review covering medical status, RTW progress, and outstanding compliance items.',
      };
    case 'PAYMENT_STEPDOWN':
      return {
        obligation: 'Weekly compensation reduces to 80% of pre-injury earnings after 13 weeks.',
        legislativeRef: 'WIRC Act 2013, s114',
        consequence: 'Incorrect payments create liability for the insurer and confusion for the worker.',
        remedy: 'Verify payment calculations have been adjusted and notify the worker of the change in writing.',
      };
    case 'CENTRELINK_CLEARANCE':
      return {
        obligation: 'Centrelink clearance must be obtained for workers receiving income support.',
        legislativeRef: 'Social Security Act 1991',
        consequence: 'Duplicate payments create recovery obligations for both the insurer and the worker.',
        remedy: 'Submit a Centrelink clearance request if not already completed.',
      };
    case 'SUITABLE_DUTIES':
      return {
        obligation: "Employers must provide suitable duties to injured workers where available.",
        legislativeRef: 'WIRC Act 2013, s82-83',
        consequence: 'Failure to provide suitable duties may result in WorkSafe prosecution.',
        remedy: "Conduct a workplace assessment to identify duties matching the worker's current capacity.",
      };
    case 'RTW_OBLIGATIONS':
      return {
        obligation: 'Both employer and worker have obligations to participate actively in the return-to-work process.',
        legislativeRef: 'WIRC Act 2013, s82-83; RTW Code of Practice',
        consequence: 'WorkSafe can issue compliance notices to either party.',
        remedy: 'Ensure both employer and worker are actively engaged and documented in the RTW process.',
      };
    case 'CLAIM_NOTIFICATION':
      return {
        obligation: 'Employer must notify the insurer of a work-related injury within 10 business days of becoming aware.',
        legislativeRef: 'WIRC Act 2013, s25',
        consequence: 'Late notification may affect claim acceptance and creates potential liability for the employer.',
        remedy: 'Submit claim notification to the insurer immediately via the WorkSafe employer portal.',
      };
    case 'PAYMENT_STEPDOWN_52WK':
      return {
        obligation: 'Weekly compensation reduces to 75% of pre-injury average weekly earnings (PIAWE) after 52 weeks off work.',
        legislativeRef: 'WIRC Act 2013, s114(2)',
        consequence: 'Incorrect payment rates create financial liability for the insurer and confusion for the worker.',
        remedy: 'Verify payment calculations have been adjusted to 75% PIAWE and notify the worker in writing at least 2 weeks in advance.',
      };
    case 'PAYMENT_STEPDOWN_130WK':
      return {
        obligation: 'Weekly compensation entitlements generally cease after 130 weeks unless the worker meets the serious injury threshold.',
        legislativeRef: 'WIRC Act 2013, s114(3)',
        consequence: 'Continued payments beyond entitlement create significant insurer liability; abrupt cessation causes worker hardship.',
        remedy: 'Assess whether the worker qualifies for the serious injury extension. If not, issue a notice of cessation at least 4 weeks before payments end.',
      };
    case 'TERMINATION_ELIGIBILITY':
      return {
        obligation: 'An employer cannot terminate a worker solely because of their work injury for the first 52 weeks of incapacity.',
        legislativeRef: 'WIRC Act 2013, s242',
        consequence: 'Unlawful termination exposes the employer to significant penalties and reinstatement orders.',
        remedy: 'Do not proceed with termination of employment during the protected period. Consult with legal counsel if termination is under consideration for other reasons.',
      };
    case 'IME_FREQUENCY':
      return {
        obligation: 'Independent Medical Examinations (IMEs) must not be scheduled more frequently than every 12 weeks unless exceptional circumstances exist.',
        legislativeRef: 'WorkSafe Claims Manual, ch.12; WIRC Act 2013, s126',
        consequence: 'Excessive IMEs can constitute harassment, trigger WorkSafe investigations, and prejudice claim outcomes.',
        remedy: 'Review IME scheduling. If a second IME is required within 12 weeks, document the exceptional clinical or legal reason.',
      };
    case 'PROVISIONAL_PAYMENTS':
      return {
        obligation: 'Provisional weekly payments must commence within 10 business days of receiving a WorkCover claim unless clear grounds for rejection exist.',
        legislativeRef: 'WIRC Act 2013, s267A',
        consequence: 'Late provisional payments breach the Act and expose the insurer to interest penalties and compliance action.',
        remedy: 'Initiate provisional payments immediately. If rejection is being considered, document clear grounds and notify WorkSafe.',
      };
    default:
      return undefined;
  }
}

/**
 * Evaluate a single rule against a case
 */
async function evaluateRule(workerCase: WorkerCaseDB, rule: ComplianceRuleDB): Promise<ComplianceCheckResult> {
  const baseResult: ComplianceCheckResult = {
    ruleCode: rule.ruleCode,
    ruleName: rule.name,
    status: 'compliant',
    severity: rule.severity,
    finding: '',
    recommendation: '',
    documentReferences: rule.documentReferences as Array<{ source: string; section: string }>,
    explanation: getExplanationForRule(rule.ruleCode),
  };

  // Evaluate based on rule type
  switch (rule.ruleCode) {
    case 'CERT_CURRENT':
      return await evaluateCertificateCurrent(workerCase, rule, baseResult);

    case 'RTW_PLAN_10WK':
      return await evaluateRTWPlan10Weeks(workerCase, rule, baseResult);

    case 'FILE_REVIEW_8WK':
      return await evaluateFileReview8Weeks(workerCase, rule, baseResult);

    case 'PAYMENT_STEPDOWN':
      return await evaluatePaymentStepDown(workerCase, rule, baseResult);

    case 'CENTRELINK_CLEARANCE':
      return await evaluateCentrelinkClearance(workerCase, rule, baseResult);

    case 'SUITABLE_DUTIES':
      return await evaluateSuitableDuties(workerCase, rule, baseResult);

    case 'RTW_OBLIGATIONS':
      return await evaluateRTWObligations(workerCase, rule, baseResult);

    case 'CLAIM_NOTIFICATION':
      return await evaluateClaimNotification(workerCase, rule, baseResult);

    case 'PAYMENT_STEPDOWN_52WK':
      return await evaluatePaymentStepdown52Wk(workerCase, rule, baseResult);

    case 'PAYMENT_STEPDOWN_130WK':
      return await evaluatePaymentStepdown130Wk(workerCase, rule, baseResult);

    case 'TERMINATION_ELIGIBILITY':
      return await evaluateTerminationEligibility(workerCase, rule, baseResult);

    case 'IME_FREQUENCY':
      return await evaluateIMEFrequency(workerCase, rule, baseResult);

    case 'PROVISIONAL_PAYMENTS':
      return await evaluateProvisionalPayments(workerCase, rule, baseResult);

    default:
      baseResult.status = 'warning';
      baseResult.finding = 'Rule evaluation not implemented';
      baseResult.recommendation = 'Manual review required';
      return baseResult;
  }
}

/**
 * CERT_CURRENT: Certificate must be current for workers off work
 */
async function evaluateCertificateCurrent(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  // Only check if worker is off work
  // Check currentStatus field for "Off work" status
  const isOffWork = workerCase.currentStatus && workerCase.currentStatus.toLowerCase().includes('off work');

  if (!isOffWork) {
    result.status = 'compliant';
    result.finding = 'Worker is not off work, certificate check not applicable';
    return result;
  }

  // Get most recent certificate
  const [latestCert] = await db.select()
    .from(medicalCertificates)
    .where(eq(medicalCertificates.caseId, workerCase.id))
    .orderBy(desc(medicalCertificates.endDate))
    .limit(1);

  if (!latestCert) {
    result.status = 'non_compliant';
    result.finding = 'No medical certificate on file. Worker is off work but has no certificate.';
    result.recommendation = rule.recommendedAction;
    return result;
  }

  const today = new Date();
  const certEndDate = new Date(latestCert.endDate);
  const daysSinceExpiry = Math.floor((today.getTime() - certEndDate.getTime()) / (1000 * 60 * 60 * 24));

  if (certEndDate < today) {
    result.status = 'non_compliant';
    result.finding = `Certificate expired ${daysSinceExpiry} days ago (expired ${certEndDate.toLocaleDateString()}). Worker is off work and requires current certificate.`;
    result.recommendation = rule.recommendedAction;
  } else if (daysSinceExpiry >= -7) {
    result.status = 'warning';
    result.finding = `Certificate expires soon (${certEndDate.toLocaleDateString()}). Request renewal to avoid gap.`;
    result.recommendation = 'Request new certificate from treating practitioner';
  } else {
    result.status = 'compliant';
    result.finding = `Certificate is current (valid until ${certEndDate.toLocaleDateString()})`;
  }

  return result;
}

/**
 * RTW_PLAN_10WK: RTW plan must be developed within 10 weeks for serious injuries
 */
async function evaluateRTWPlan10Weeks(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  // Calculate weeks since injury
  const injuryDate = new Date(workerCase.dateOfInjury);
  const today = new Date();
  const weeksSinceInjury = Math.floor((today.getTime() - injuryDate.getTime()) / (1000 * 60 * 60 * 24 * 7));

  // Get RTW plan status from case data
  const rtwStatus = workerCase.clinicalStatusJson?.rtwPlanStatus;

  // If injury is less than 10 weeks old, not applicable yet
  if (weeksSinceInjury < 10) {
    result.status = 'compliant';
    result.finding = `Injury is ${weeksSinceInjury} weeks old. RTW plan requirement applies after 10 weeks.`;
    return result;
  }

  // Evaluate based on RTW plan status
  switch (rtwStatus) {
    case 'not_planned':
      result.status = 'non_compliant';
      result.finding = `RTW plan not initiated after ${weeksSinceInjury} weeks. Plan required within 10 weeks of serious injury.`;
      result.recommendation = rule.recommendedAction;
      break;

    case 'planned_not_started':
      result.status = 'warning';
      result.finding = `RTW plan exists but not started after ${weeksSinceInjury} weeks. Requires activation.`;
      result.recommendation = 'Activate RTW plan and begin implementation';
      break;

    case 'in_progress':
    case 'working_well':
    case 'completed':
      result.status = 'compliant';
      result.finding = `RTW plan is active and progressing (${weeksSinceInjury} weeks post-injury, status: ${rtwStatus})`;
      break;

    case 'failing':
      result.status = 'non_compliant';
      result.finding = `RTW plan is failing after ${weeksSinceInjury} weeks. Requires intervention and plan revision.`;
      result.recommendation = 'Review and revise RTW plan with stakeholders';
      break;

    default:
      // No RTW plan status recorded
      result.status = 'warning';
      result.finding = `RTW plan status unknown after ${weeksSinceInjury} weeks. Manual assessment required.`;
      result.recommendation = 'Assess RTW plan status and update case records';
  }

  return result;
}

/**
 * FILE_REVIEW_8WK: Case must be reviewed every 8 weeks
 */
async function evaluateFileReview8Weeks(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  // This requires review tracking which we don't have yet
  // For now, use updatedAt as a proxy
  const lastUpdate = workerCase.updatedAt ? new Date(workerCase.updatedAt) : new Date();
  const today = new Date();
  const daysSinceUpdate = Math.floor((today.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceUpdate > 56) {
    result.status = 'non_compliant';
    result.finding = `Case has not been reviewed in ${daysSinceUpdate} days (last update: ${lastUpdate.toLocaleDateString()}). Exceeds 8-week requirement.`;
    result.recommendation = rule.recommendedAction;
  } else if (daysSinceUpdate > 49) {
    result.status = 'warning';
    result.finding = `Case review due soon (last update: ${lastUpdate.toLocaleDateString()}, ${daysSinceUpdate} days ago)`;
    result.recommendation = 'Schedule review within 1 week';
  } else {
    result.status = 'compliant';
    result.finding = `Case reviewed recently (${daysSinceUpdate} days ago)`;
  }

  return result;
}

/**
 * PAYMENT_STEPDOWN: Inform worker of payment reduction after 13 weeks
 */
async function evaluatePaymentStepDown(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const workStatus = workerCase.workStatus;
  const injuryDate = new Date(workerCase.dateOfInjury);
  const today = new Date();
  const weeksSinceInjury = Math.floor((today.getTime() - injuryDate.getTime()) / (1000 * 60 * 60 * 24 * 7));

  // If worker is at work, step-down is not applicable
  if (workStatus === 'At work' || workStatus === 'Working alternate role') {
    result.status = 'compliant';
    result.finding = 'Worker has returned to work. Payment step-down not applicable.';
    return result;
  }

  // Check if worker is off work and past 13 weeks
  if (workStatus === 'Off work') {
    if (weeksSinceInjury < 13) {
      result.status = 'compliant';
      result.finding = `Worker is ${weeksSinceInjury} weeks post-injury. Payment step-down applies after 13 weeks.`;
    } else if (weeksSinceInjury >= 13 && weeksSinceInjury <= 15) {
      // Grace period around 13 weeks
      result.status = 'warning';
      result.finding = `Worker is ${weeksSinceInjury} weeks post-injury. Payment step-down should be reviewed and implemented if applicable.`;
      result.recommendation = 'Review payment entitlements and implement step-down provisions per WorkSafe guidelines';
    } else {
      // Well past 13 weeks
      result.status = 'warning';
      result.finding = `Worker is ${weeksSinceInjury} weeks post-injury (>13 weeks). Verify payment step-down has been implemented.`;
      result.recommendation = 'Confirm payment step-down provisions are correctly applied per WorkSafe requirements';
    }
  } else {
    // Work status unclear
    result.status = 'compliant';
    result.finding = 'Payment step-down compliance requires assessment based on current work status and payment arrangements.';
  }

  return result;
}

/**
 * CENTRELINK_CLEARANCE: Must have Centrelink clearance before payments
 */
async function evaluateCentrelinkClearance(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const workStatus = workerCase.workStatus;
  const clinicalStatus = workerCase.clinicalStatusJson;

  // If worker has returned to work, Centrelink clearance may not be required
  if (workStatus === 'At work' || workStatus === 'Working alternate role') {
    result.status = 'compliant';
    result.finding = 'Worker has returned to work. Centrelink clearance requirements may not apply.';
    return result;
  }

  // Check if Centrelink clearance is documented in clinical status
  if (clinicalStatus && 'centrelinkClearance' in clinicalStatus) {
    if (clinicalStatus.centrelinkClearance === true) {
      result.status = 'compliant';
      result.finding = 'Centrelink clearance documented and confirmed.';
    } else if (clinicalStatus.centrelinkClearance === false) {
      result.status = 'non_compliant';
      result.finding = 'Centrelink clearance explicitly noted as not obtained.';
      result.recommendation = rule.recommendedAction;
    } else {
      result.status = 'warning';
      result.finding = 'Centrelink clearance status unclear from documentation.';
      result.recommendation = 'Verify and document Centrelink clearance status';
    }
    return result;
  }

  // Check if worker is likely receiving payments (off work)
  if (workStatus === 'Off work') {
    const injuryDate = new Date(workerCase.dateOfInjury);
    const today = new Date();
    const weeksSinceInjury = Math.floor((today.getTime() - injuryDate.getTime()) / (1000 * 60 * 60 * 24 * 7));

    // For longer-term claims, Centrelink clearance becomes more important
    if (weeksSinceInjury > 4) {
      result.status = 'warning';
      result.finding = `Worker off work for ${weeksSinceInjury} weeks. Centrelink clearance status should be verified and documented.`;
      result.recommendation = 'Obtain and document Centrelink clearance before processing ongoing payments';
    } else {
      result.status = 'compliant';
      result.finding = `Early claim (${weeksSinceInjury} weeks). Centrelink clearance may not yet be required.`;
    }
  } else {
    // Work status unclear, default to requiring verification
    result.status = 'warning';
    result.finding = 'Centrelink clearance status unknown. Manual verification required for payment compliance.';
    result.recommendation = 'Verify and document Centrelink clearance status in case records';
  }

  return result;
}

/**
 * SUITABLE_DUTIES: Employer must provide suitable duties
 */
async function evaluateSuitableDuties(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const rtwStatus = workerCase.clinicalStatusJson?.rtwPlanStatus;
  const functionalCapacity = workerCase.clinicalStatusJson?.functionalCapacity;
  const workStatus = workerCase.workStatus;

  // If worker has returned to work, suitable duties requirement is satisfied
  if (workStatus === 'At work' || workStatus === 'Working alternate role') {
    result.status = 'compliant';
    result.finding = 'Worker has returned to work. Suitable duties requirement satisfied.';
    return result;
  }

  // Check if RTW plan indicates suitable duties work
  if (rtwStatus === 'working_well' || rtwStatus === 'completed') {
    result.status = 'compliant';
    result.finding = 'RTW plan shows suitable duties are working well or completed.';
    return result;
  }

  // If worker is off work and has functional capacity, suitable duties should be assessed
  if (workStatus === 'Off work' && functionalCapacity) {
    // Check if RTW plan is in progress (indicating suitable duties consideration)
    if (rtwStatus === 'in_progress' || rtwStatus === 'planned_not_started') {
      result.status = 'warning';
      result.finding = 'Worker has functional capacity but RTW plan is still developing. Monitor suitable duties identification.';
      result.recommendation = 'Ensure suitable duties are identified and offered as part of RTW plan';
    } else if (rtwStatus === 'failing') {
      result.status = 'non_compliant';
      result.finding = 'Worker has functional capacity but RTW plan is failing. Suitable duties may not have been properly identified or offered.';
      result.recommendation = rule.recommendedAction;
    } else {
      result.status = 'warning';
      result.finding = 'Worker has functional capacity but suitable duties status unclear.';
      result.recommendation = 'Assess suitable duties availability with employer';
    }
  } else if (workStatus === 'Off work' && !functionalCapacity) {
    // Worker has no functional capacity documented - suitable duties not applicable
    result.status = 'compliant';
    result.finding = 'Worker off work with no functional capacity documented. Suitable duties requirement not applicable.';
  } else {
    // Default case - requires manual review
    result.status = 'warning';
    result.finding = 'Suitable duties compliance requires manual assessment based on worker capacity and employer capabilities.';
    result.recommendation = 'Review worker capacity and employer suitable duties options';
  }

  return result;
}

/**
 * RTW_OBLIGATIONS: Parties must cooperate in RTW process
 */
async function evaluateRTWObligations(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const rtwStatus = workerCase.clinicalStatusJson?.rtwPlanStatus;
  const workStatus = workerCase.workStatus;
  const lastUpdate = new Date(workerCase.updatedAt || workerCase.createdAt || Date.now());
  const today = new Date();
  const daysSinceUpdate = Math.floor((today.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));

  // If worker has returned to work successfully, obligations are met
  if (workStatus === 'At work' || rtwStatus === 'completed' || rtwStatus === 'working_well') {
    result.status = 'compliant';
    result.finding = 'Worker has successfully returned to work or RTW plan is working well. Obligations are being met.';
    return result;
  }

  // Check for signs of cooperation/engagement
  if (rtwStatus === 'in_progress') {
    if (daysSinceUpdate <= 14) {
      result.status = 'compliant';
      result.finding = 'RTW plan in progress with recent case activity. Parties appear to be cooperating.';
    } else {
      result.status = 'warning';
      result.finding = `RTW plan in progress but no case updates for ${daysSinceUpdate} days. May indicate reduced engagement.`;
      result.recommendation = 'Check with all parties on RTW plan progress and engagement';
    }
    return result;
  }

  // Check for signs of non-cooperation
  if (rtwStatus === 'failing') {
    result.status = 'non_compliant';
    result.finding = 'RTW plan is failing which may indicate lack of cooperation from one or more parties.';
    result.recommendation = rule.recommendedAction;
    return result;
  }

  // Assess based on case activity and status
  if (workStatus === 'Off work') {
    if (rtwStatus === 'not_planned' && daysSinceUpdate > 30) {
      result.status = 'warning';
      result.finding = `Worker off work with no RTW plan and no case activity for ${daysSinceUpdate} days. Cooperation may be lacking.`;
      result.recommendation = 'Engage all parties to assess RTW cooperation and obligations';
    } else if (rtwStatus === 'planned_not_started' && daysSinceUpdate > 21) {
      result.status = 'warning';
      result.finding = 'RTW plan exists but not started with limited recent activity. Monitor party cooperation.';
      result.recommendation = 'Follow up on RTW plan activation and party engagement';
    } else if (daysSinceUpdate <= 21) {
      result.status = 'compliant';
      result.finding = 'Recent case activity indicates ongoing engagement and cooperation with RTW obligations.';
    } else {
      result.status = 'warning';
      result.finding = `Limited case activity (${daysSinceUpdate} days since update). RTW obligation compliance unclear.`;
      result.recommendation = 'Assess current level of worker and employer cooperation with RTW process';
    }
  } else {
    // Worker status unclear, default to compliant with monitoring
    result.status = 'compliant';
    result.finding = 'RTW obligations compliance requires ongoing monitoring of party cooperation.';
  }

  return result;
}

/** Count business days between two dates (Mon–Fri only). */
function countBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const fin = new Date(end);
  fin.setHours(0, 0, 0, 0);
  while (cur < fin) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * CLAIM_NOTIFICATION: Employer must notify insurer within 10 business days of injury
 */
async function evaluateClaimNotification(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const injuryDate = new Date(workerCase.dateOfInjury);
  const today = new Date();
  const businessDaysSince = countBusinessDays(injuryDate, today);

  // Check if claim notified — use createdAt as a proxy for notification date
  const notifiedDate = workerCase.createdAt ? new Date(workerCase.createdAt) : null;
  const businessDaysToNotify = notifiedDate ? countBusinessDays(injuryDate, notifiedDate) : businessDaysSince;

  if (businessDaysSince <= 10) {
    result.status = 'compliant';
    result.finding = `Claim is ${businessDaysSince} business days old. Notification window open (10 business days).`;
    return result;
  }

  if (businessDaysToNotify > 10) {
    result.status = 'non_compliant';
    result.finding = `Claim notification appears late — ${businessDaysSince} business days since injury (threshold: 10). Verify insurer was notified within 10 business days.`;
    result.recommendation = rule.recommendedAction || 'Submit claim notification to insurer immediately and document the reason for delay.';
  } else {
    result.status = 'compliant';
    result.finding = `Claim was entered into the system ${businessDaysToNotify} business days after injury. Notification appears timely.`;
  }

  return result;
}

/**
 * PAYMENT_STEPDOWN_52WK: Weekly compensation reduces to 75% after 52 weeks
 */
async function evaluatePaymentStepdown52Wk(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const isOffWork = workerCase.workStatus === 'Off work';
  if (!isOffWork) {
    result.status = 'compliant';
    result.finding = 'Worker is not off work. Payment step-down at 52 weeks not applicable.';
    return result;
  }

  const injuryDate = new Date(workerCase.dateOfInjury);
  const weeksSinceInjury = Math.floor((Date.now() - injuryDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

  if (weeksSinceInjury < 50) {
    result.status = 'compliant';
    result.finding = `Worker is ${weeksSinceInjury} weeks post-injury. 52-week payment step-down not yet applicable.`;
  } else if (weeksSinceInjury < 52) {
    result.status = 'warning';
    result.finding = `Worker is ${weeksSinceInjury} weeks post-injury. Payment step-down to 75% PIAWE applies in ${52 - weeksSinceInjury} weeks. Prepare worker notification.`;
    result.recommendation = 'Prepare written notice of payment reduction for the worker at least 2 weeks before the step-down date.';
  } else {
    result.status = 'non_compliant';
    result.finding = `Worker is ${weeksSinceInjury} weeks post-injury (past 52-week threshold). Verify payments have been reduced to 75% PIAWE and worker was notified in writing.`;
    result.recommendation = rule.recommendedAction || 'Confirm payment rate adjustment and provide written notification to the worker.';
  }

  return result;
}

/**
 * PAYMENT_STEPDOWN_130WK: Compensation generally ceases at 130 weeks
 */
async function evaluatePaymentStepdown130Wk(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const isOffWork = workerCase.workStatus === 'Off work';
  if (!isOffWork) {
    result.status = 'compliant';
    result.finding = 'Worker is not off work. 130-week payment cessation not applicable.';
    return result;
  }

  const injuryDate = new Date(workerCase.dateOfInjury);
  const weeksSinceInjury = Math.floor((Date.now() - injuryDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

  if (weeksSinceInjury < 126) {
    result.status = 'compliant';
    result.finding = `Worker is ${weeksSinceInjury} weeks post-injury. 130-week payment cessation not yet applicable.`;
  } else if (weeksSinceInjury < 130) {
    result.status = 'warning';
    result.finding = `Worker is ${weeksSinceInjury} weeks post-injury. Payments may cease in ${130 - weeksSinceInjury} weeks unless serious injury threshold is met. Assess entitlement urgently.`;
    result.recommendation = 'Assess serious injury threshold eligibility. Issue cessation notice at least 4 weeks before payments end.';
  } else {
    result.status = 'non_compliant';
    result.finding = `Worker is ${weeksSinceInjury} weeks post-injury (past 130-week threshold). Verify payment status and whether serious injury extension applies.`;
    result.recommendation = rule.recommendedAction || 'Review payment status immediately. If no extension applies, cease payments and document decision.';
  }

  return result;
}

/**
 * TERMINATION_ELIGIBILITY: Employer cannot terminate in first 52 weeks of incapacity
 */
async function evaluateTerminationEligibility(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const injuryDate = new Date(workerCase.dateOfInjury);
  const weeksSinceInjury = Math.floor((Date.now() - injuryDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const isOffWork = workerCase.workStatus === 'Off work';

  // Check if a termination process has been initiated
  const hasTerminationProcess = (workerCase as any).terminationProcessId != null;

  if (!isOffWork) {
    result.status = 'compliant';
    result.finding = 'Worker is not currently off work. Termination protection not in active scope.';
    return result;
  }

  if (weeksSinceInjury < 52) {
    if (hasTerminationProcess) {
      result.status = 'non_compliant';
      result.finding = `Termination process initiated at ${weeksSinceInjury} weeks — before the 52-week protected period has elapsed. This may constitute unlawful termination.`;
      result.recommendation = rule.recommendedAction || 'Halt termination process and seek legal advice immediately. Employer must not terminate during the 52-week protection period.';
    } else {
      result.status = 'compliant';
      result.finding = `Worker is ${weeksSinceInjury} weeks post-injury and within the 52-week termination protection period. No termination process detected.`;
    }
  } else {
    result.status = 'compliant';
    result.finding = `Worker is ${weeksSinceInjury} weeks post-injury (past 52-week threshold). Termination protection period has elapsed. Standard employment law applies.`;
  }

  return result;
}

/**
 * IME_FREQUENCY: IMEs must not be scheduled more often than every 12 weeks
 */
async function evaluateIMEFrequency(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  // IME history stored in clinical_status_json
  const clinicalStatus = workerCase.clinicalStatusJson;
  const imeHistory: Array<{ date: string }> = (clinicalStatus as any)?.imeHistory ?? [];

  if (imeHistory.length === 0) {
    result.status = 'compliant';
    result.finding = 'No IME history recorded. Rule not triggered.';
    return result;
  }

  // Sort by date descending
  const sorted = [...imeHistory]
    .map(e => new Date(e.date))
    .sort((a, b) => b.getTime() - a.getTime());

  if (sorted.length < 2) {
    result.status = 'compliant';
    result.finding = 'Only one IME recorded. Frequency rule not triggered.';
    return result;
  }

  const latest = sorted[0];
  const previous = sorted[1];
  const weeksBetween = Math.floor((latest.getTime() - previous.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const weeksSinceLast = Math.floor((Date.now() - latest.getTime()) / (7 * 24 * 60 * 60 * 1000));

  if (weeksBetween < 12) {
    result.status = 'non_compliant';
    result.finding = `Two IMEs were scheduled only ${weeksBetween} weeks apart (minimum 12 weeks required). This may constitute excessive examination.`;
    result.recommendation = rule.recommendedAction || 'Review IME scheduling. Document exceptional circumstances if a third-party review of this frequency is required.';
  } else if (weeksSinceLast < 10) {
    result.status = 'warning';
    result.finding = `Last IME was ${weeksSinceLast} weeks ago. Scheduling another IME within the next 2 weeks would breach the 12-week minimum interval.`;
    result.recommendation = 'Do not schedule next IME until at least 12 weeks have elapsed from the last examination.';
  } else {
    result.status = 'compliant';
    result.finding = `IMEs are appropriately spaced (last two: ${weeksBetween} weeks apart). Next eligible IME date is after ${new Date(latest.getTime() + 12 * 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-AU')}.`;
  }

  return result;
}

/**
 * PROVISIONAL_PAYMENTS: Must commence within 10 business days of claim receipt
 */
async function evaluateProvisionalPayments(
  workerCase: WorkerCaseDB,
  rule: ComplianceRuleDB,
  result: ComplianceCheckResult
): Promise<ComplianceCheckResult> {
  const isOffWork = workerCase.workStatus === 'Off work';
  if (!isOffWork) {
    result.status = 'compliant';
    result.finding = 'Worker is not off work. Provisional payment obligation not triggered.';
    return result;
  }

  const claimDate = workerCase.createdAt ? new Date(workerCase.createdAt) : null;
  const injuryDate = new Date(workerCase.dateOfInjury);

  if (!claimDate) {
    result.status = 'warning';
    result.finding = 'Claim receipt date not recorded. Unable to verify provisional payment timeline.';
    result.recommendation = 'Record the date the WorkCover claim was received and verify provisional payments commenced within 10 business days.';
    return result;
  }

  const businessDaysSinceClaim = countBusinessDays(claimDate, new Date());
  const businessDaysInjuryToClaim = countBusinessDays(injuryDate, claimDate);

  if (businessDaysSinceClaim <= 10) {
    result.status = 'compliant';
    result.finding = `Claim received ${businessDaysSinceClaim} business days ago. Provisional payment window still open (10 business days from claim receipt).`;
  } else {
    // Claim is old enough — flag for review if payments may not have started
    const weeksSinceInjury = Math.floor((Date.now() - injuryDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (weeksSinceInjury < 2 && businessDaysSinceClaim <= 12) {
      result.status = 'warning';
      result.finding = `Claim is ${businessDaysSinceClaim} business days old. Confirm provisional payments commenced or rejection was issued within 10 business days.`;
      result.recommendation = 'Verify payment commencement date or document grounds for rejection.';
    } else {
      result.status = 'compliant';
      result.finding = `Provisional payment window has passed (claim ${businessDaysSinceClaim} business days old). Verify payments commenced or rejection was issued within the initial 10-business-day window.`;
    }
  }

  return result;
}

/**
 * Create a compliance-related action for non-compliant rules
 */
async function createComplianceAction(
  caseId: string,
  ruleCode: string,
  finding: string,
  recommendation: string
): Promise<string | null> {
  try {
    // Map rule codes to appropriate action types
    let actionType: CaseActionType;
    let actionNotes: string;
    let dueDate: Date | undefined;

    switch (ruleCode) {
      case 'RTW_PLAN_10WK':
        actionType = 'review_case';
        actionNotes = `COMPLIANCE: RTW Plan Development Required - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        break;

      case 'SUITABLE_DUTIES':
        actionType = 'follow_up';
        actionNotes = `COMPLIANCE: Suitable Duties Assessment - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
        break;

      case 'RTW_OBLIGATIONS':
        actionType = 'follow_up';
        actionNotes = `COMPLIANCE: RTW Obligations Review - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
        break;

      case 'PAYMENT_STEPDOWN':
        actionType = 'review_case';
        actionNotes = `COMPLIANCE: Payment Step-Down Review - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        break;

      case 'CENTRELINK_CLEARANCE':
        actionType = 'follow_up';
        actionNotes = `COMPLIANCE: Centrelink Clearance Verification - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days
        break;

      case 'CLAIM_NOTIFICATION':
        actionType = 'follow_up';
        actionNotes = `COMPLIANCE: Claim Notification (s25) - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000); // 1 day — urgent
        break;

      case 'PAYMENT_STEPDOWN_52WK':
        actionType = 'review_case';
        actionNotes = `COMPLIANCE: 52-Week Payment Step-Down (s114) - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        break;

      case 'PAYMENT_STEPDOWN_130WK':
        actionType = 'review_case';
        actionNotes = `COMPLIANCE: 130-Week Payment Cessation (s114) - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
        break;

      case 'TERMINATION_ELIGIBILITY':
        actionType = 'follow_up';
        actionNotes = `COMPLIANCE: Termination Protection (s242) - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000); // 1 day — urgent
        break;

      case 'IME_FREQUENCY':
        actionType = 'review_case';
        actionNotes = `COMPLIANCE: IME Frequency Breach - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
        break;

      case 'PROVISIONAL_PAYMENTS':
        actionType = 'follow_up';
        actionNotes = `COMPLIANCE: Provisional Payments (s267A) - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000); // 1 day — urgent
        break;

      default:
        // For other compliance rules, use a generic follow-up action
        actionType = 'follow_up';
        actionNotes = `COMPLIANCE: ${ruleCode} - ${finding}. Action: ${recommendation}`;
        dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
    }

    // Create or update the action using the storage layer
    const action = await storage.upsertAction(caseId, actionType, dueDate, actionNotes);

    return action.id;
  } catch (error) {
    console.error(`[ComplianceEngine] Failed to create action for rule ${ruleCode}:`, error);
    return null;
  }
}

/**
 * Get latest compliance report for a case
 */
export async function getLatestComplianceReport(caseId: string): Promise<ComplianceCheckResult[]> {
  const checks = await db.select({
    ruleCode: complianceRules.ruleCode,
    ruleName: complianceRules.name,
    status: caseComplianceChecks.status,
    severity: complianceRules.severity,
    finding: caseComplianceChecks.finding,
    recommendation: caseComplianceChecks.recommendation,
    documentReferences: complianceRules.documentReferences,
  })
    .from(caseComplianceChecks)
    .innerJoin(complianceRules, eq(caseComplianceChecks.ruleId, complianceRules.id))
    .where(eq(caseComplianceChecks.caseId, caseId))
    .orderBy(desc(caseComplianceChecks.checkedAt));

  // Group by rule and take the latest check for each
  const latestChecks = new Map<string, any>();
  for (const check of checks) {
    if (!latestChecks.has(check.ruleCode)) {
      latestChecks.set(check.ruleCode, check);
    }
  }

  return Array.from(latestChecks.values()).map(check => ({
    ruleCode: check.ruleCode,
    ruleName: check.ruleName,
    status: check.status,
    severity: check.severity,
    finding: check.finding || '',
    recommendation: check.recommendation || '',
    documentReferences: check.documentReferences as Array<{ source: string; section: string }>,
  }));
}
