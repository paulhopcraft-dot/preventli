import "dotenv/config";
import bcrypt from "bcrypt";
import { inArray } from "drizzle-orm";
import { db, pool } from "./db";
import {
  organizations,
  users,
  workers,
  workerCases,
  preEmploymentAssessments,
  medicalCertificates,
  caseAttachments,
  telehealthBookings,
  rtwPlans,
  rtwPlanVersions,
  agentJobs,
  type FunctionalRestrictionsExtracted,
} from "@shared/schema";

/**
 * Wallara demo seed — single employer tenant for the live app.preventli.ai demo.
 *
 * Creates:
 *   - 1 organization (Wallara, kind=employer)
 *   - 1 user (Ellen Burns, role=employer, password wallara01)
 *   - 6 workers across pre-employment / injury / preventative / exit phases
 *   - 6 pre-employment assessments (5 passed + 1 in-progress awaiting approval)
 *   - 3 worker_cases (Sarah injury, Marcus injury+RTW, Priya preventative)
 *   - 2 telehealth bookings (James + Liam exit appointments)
 *   - 3 medical certificates for Sarah, 4 for Marcus (date-aligned to recovery)
 *   - Diagnosis-scan caseAttachments (Sarah: 1 MRI, Marcus: ultrasound + MRI)
 *   - 1 rtwPlan + rtwPlanVersion for Marcus
 *   - 1 pre-baked coordinator agentJobs row (the morning briefing)
 *
 * Idempotent: deletes all rows where organization_id = WALLARA_ORG_ID before insert.
 *
 * Image strategy: diagnosis scans use real public-domain / CC medical images
 * from Wikimedia Commons (so Sarah's lumbar MRI doesn't render as a stock dog
 * photo). Certificate jpgs and other placeholder images still use picsum.photos.
 * No filesystem writes — keeps the seed fast and never blocks boot.
 *
 * Usage:
 *   npm run seed:wallara
 */

const WALLARA_ORG_ID = "org-wallara";
const USER_ELLEN_ID = "user-wallara-ellen";

const WORKER_SARAH_ID = "worker-wallara-sarah";
const WORKER_MARCUS_ID = "worker-wallara-marcus";
const WORKER_PRIYA_ID = "worker-wallara-priya";
const WORKER_JAMES_ID = "worker-wallara-james";
const WORKER_AISHA_ID = "worker-wallara-aisha";
const WORKER_LIAM_ID = "worker-wallara-liam";

const CASE_SARAH_ID = "case-wallara-sarah";
const CASE_MARCUS_ID = "case-wallara-marcus";
const CASE_PRIYA_ID = "case-wallara-priya";

const RTW_PLAN_MARCUS_ID = "rtw-plan-wallara-marcus";
const RTW_PLAN_VERSION_MARCUS_ID = "rtw-plan-version-wallara-marcus-v1";

const AGENT_JOB_BRIEFING_ID = "agent-job-wallara-briefing";

const DAY_MS = 24 * 60 * 60 * 1000;

function picsum(seed: string): string {
  return `https://picsum.photos/seed/${seed}/800/600`;
}

/**
 * Returns a real medical-scan URL from Wikimedia Commons. Falls back to
 * picsum.photos if the caller passes an empty primary URL, so the seed never
 * breaks even if a Wikimedia file is later moved or deleted.
 */
function scanUrl(primary: string, fallbackSeed: string): string {
  try {
    if (primary && primary.startsWith("https://")) return primary;
    return picsum(fallbackSeed);
  } catch {
    return picsum(fallbackSeed);
  }
}

const BRIEFING_SUMMARY = `Good morning. Here's your overnight status for Wallara.

Last night I:
• Reviewed certificate expirations across 4 active workers — no urgent renewals needed today.
• Updated Marcus Tanaka's recovery trend — capacity improving, on track for full duties review in 2 weeks.
• Flagged Sarah Chen's RTW plan as ready to draft (week-4 milestone reached).

Today you should:
• Approve the draft RTW plan for Sarah Chen when ready — medical clearance is in.
• Check in with Marcus about the new restricted-duties schedule starting Monday.
• Review Priya Reddy's preventative intake notes — flagged for ergonomic follow-up.

Status:
• 2 active injury claims, 2 preventative cases on the watchlist.
• 1 exit interview completed last week (James O'Brien).
• Compliance: all green. Next WorkSafe deadline: 14 days for Marcus's progress report.

I'll keep watching overnight.`;

async function seedWallara(): Promise<void> {
  console.log("[seed-wallara] Starting Wallara demo seed...");
  const now = new Date();

  // ── 1. Idempotent cleanup ──────────────────────────────────────────────────
  // Delete in FK-safe order (children first), all scoped to WALLARA_ORG_ID.
  console.log("[seed-wallara] Cleaning prior Wallara rows...");

  // Find existing case ids first (for child-table cleanup that lacks org_id).
  const existingCases = await db
    .select({ id: workerCases.id })
    .from(workerCases)
    .where(inArray(workerCases.organizationId, [WALLARA_ORG_ID]));
  const existingCaseIds = existingCases.map((c) => c.id);

  // Find existing plan ids for plan-version cleanup.
  const existingPlans = await db
    .select({ id: rtwPlans.id })
    .from(rtwPlans)
    .where(inArray(rtwPlans.organizationId, [WALLARA_ORG_ID]));
  const existingPlanIds = existingPlans.map((p) => p.id);

  // agent_jobs cascades from worker_cases (FK ON DELETE CASCADE), but our
  // briefing row has no caseId so delete it explicitly by org.
  await db.delete(agentJobs).where(inArray(agentJobs.organizationId, [WALLARA_ORG_ID]));

  if (existingPlanIds.length > 0) {
    await db.delete(rtwPlanVersions).where(inArray(rtwPlanVersions.planId, existingPlanIds));
  }
  await db.delete(rtwPlans).where(inArray(rtwPlans.organizationId, [WALLARA_ORG_ID]));

  if (existingCaseIds.length > 0) {
    await db.delete(medicalCertificates).where(inArray(medicalCertificates.caseId, existingCaseIds));
    await db.delete(caseAttachments).where(inArray(caseAttachments.caseId, existingCaseIds));
  }

  await db.delete(telehealthBookings).where(inArray(telehealthBookings.organizationId as any, [WALLARA_ORG_ID]));
  await db.delete(preEmploymentAssessments).where(inArray(preEmploymentAssessments.organizationId, [WALLARA_ORG_ID]));
  await db.delete(workerCases).where(inArray(workerCases.organizationId, [WALLARA_ORG_ID]));
  await db.delete(workers).where(inArray(workers.organizationId as any, [WALLARA_ORG_ID]));
  await db.delete(users).where(inArray(users.id, [USER_ELLEN_ID]));
  await db.delete(organizations).where(inArray(organizations.id, [WALLARA_ORG_ID]));

  // ── 2. Organization ────────────────────────────────────────────────────────
  console.log("[seed-wallara] Inserting organization...");
  await db.insert(organizations).values({
    id: WALLARA_ORG_ID,
    name: "Wallara",
    slug: "wallara",
    kind: "employer",
    contactName: "Ellen Burns",
    contactEmail: "wallara@wallara.com.au",
    contactPhone: "03 9000 9000",
    worksafeState: "VIC",
    state: "VIC",
    employeeCount: "201-500",
    notes: "Disability services provider — demo tenant.",
  } as any);

  // ── 3. User: Ellen Burns ───────────────────────────────────────────────────
  console.log("[seed-wallara] Inserting user (Ellen Burns)...");
  const passwordHash = await bcrypt.hash("wallara01", 10);
  await db.insert(users).values({
    id: USER_ELLEN_ID,
    organizationId: WALLARA_ORG_ID,
    email: "wallara@wallara.com.au",
    password: passwordHash,
    role: "employer",
    subrole: "people-and-culture-manager",
    companyId: null,
    insurerId: null,
    isActive: true,
    emailVerified: true,
    emailVerifiedAt: now,
  } as any);

  // ── 4. Workers ─────────────────────────────────────────────────────────────
  console.log("[seed-wallara] Inserting 6 workers...");
  await db.insert(workers).values([
    {
      id: WORKER_SARAH_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Sarah Chen",
      email: "sarah.chen@wallara.com.au",
      phone: "0411 111 111",
    },
    {
      id: WORKER_MARCUS_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Marcus Tanaka",
      email: "marcus.tanaka@wallara.com.au",
      phone: "0422 222 222",
    },
    {
      id: WORKER_PRIYA_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Priya Reddy",
      email: "priya.reddy@wallara.com.au",
      phone: "0433 333 333",
    },
    {
      id: WORKER_JAMES_ID,
      organizationId: WALLARA_ORG_ID,
      name: "James O'Brien",
      email: "james.obrien@wallara.com.au",
      phone: "0444 444 444",
    },
    {
      id: WORKER_AISHA_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Aisha Patel",
      email: "aisha.patel@wallara.com.au",
      phone: "0455 555 555",
    },
    {
      id: WORKER_LIAM_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Liam Brennan",
      email: "liam.brennan@wallara.com.au",
      phone: "0466 666 666",
    },
  ] as any);

  // ── 5. Pre-employment assessments (one per worker, all passed) ─────────────
  console.log("[seed-wallara] Inserting pre-employment assessments...");
  await db.insert(preEmploymentAssessments).values([
    {
      id: "preemp-wallara-sarah",
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_SARAH_ID,
      candidateName: "Sarah Chen",
      candidateEmail: "sarah.chen@wallara.com.au",
      positionTitle: "Disability Support Worker",
      assessmentType: "baseline_health",
      status: "completed",
      clearanceLevel: "cleared_unconditional",
      completedDate: new Date(now.getTime() - 540 * DAY_MS), // ~18 months ago
      assessorName: "Dr. Helen Mead",
      assessorType: "GP",
    },
    {
      id: "preemp-wallara-marcus",
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_MARCUS_ID,
      candidateName: "Marcus Tanaka",
      candidateEmail: "marcus.tanaka@wallara.com.au",
      positionTitle: "Maintenance Officer",
      assessmentType: "functional_capacity",
      status: "completed",
      clearanceLevel: "cleared_unconditional",
      completedDate: new Date(now.getTime() - 730 * DAY_MS), // ~2 years ago
      assessorName: "Dr. Helen Mead",
      assessorType: "Occupational Physician",
    },
    {
      id: "preemp-wallara-priya",
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_PRIYA_ID,
      candidateName: "Priya Reddy",
      candidateEmail: "priya.reddy@wallara.com.au",
      positionTitle: "Support Coordinator",
      assessmentType: "baseline_health",
      status: "completed",
      clearanceLevel: "cleared_unconditional",
      completedDate: new Date(now.getTime() - 30 * DAY_MS), // ~1 month ago
      assessorName: "Dr. Helen Mead",
      assessorType: "GP",
    },
    {
      id: "preemp-wallara-james",
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_JAMES_ID,
      candidateName: "James O'Brien",
      candidateEmail: "james.obrien@wallara.com.au",
      positionTitle: "Team Leader",
      assessmentType: "baseline_health",
      status: "completed",
      clearanceLevel: "cleared_unconditional",
      completedDate: new Date(now.getTime() - 1095 * DAY_MS), // ~3 years ago
      assessorName: "Dr. Helen Mead",
      assessorType: "GP",
    },
    {
      // Aisha Patel — submitted questionnaire, awaiting employer approval.
      // status="in_progress" matches storage.updateAssessmentResponses() — set
      // when the worker submits the questionnaire but before the AI report /
      // clearance decision is finalised.
      id: "preemp-wallara-aisha",
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_AISHA_ID,
      candidateName: "Aisha Patel",
      candidateEmail: "aisha.patel@wallara.com.au",
      positionTitle: "Disability Support Worker",
      assessmentType: "baseline_health",
      status: "in_progress",
      sentAt: new Date(now.getTime() - 5 * DAY_MS),
      assessorName: "Dr. Helen Mead",
      assessorType: "GP",
      questionnaireResponses: {
        submittedAt: new Date(now.getTime() - 3 * DAY_MS).toISOString(),
        priorInjuries: "No prior workplace injuries.",
        chronicConditions: "Nil reported.",
        medications: "None.",
        physicalCapacity: "Self-rated full capacity for role demands.",
      } as any,
    },
    {
      // Liam Brennan — completed pre-emp 4 years ago, now exiting.
      id: "preemp-wallara-liam",
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_LIAM_ID,
      candidateName: "Liam Brennan",
      candidateEmail: "liam.brennan@wallara.com.au",
      positionTitle: "Support Coordinator",
      assessmentType: "baseline_health",
      status: "completed",
      clearanceLevel: "cleared_unconditional",
      completedDate: new Date(now.getTime() - 1460 * DAY_MS), // ~4 years ago
      assessorName: "Dr. Helen Mead",
      assessorType: "GP",
    },
  ] as any);

  // ── 6. Worker cases ────────────────────────────────────────────────────────
  console.log("[seed-wallara] Inserting worker cases...");

  // Sarah Chen — injury, lumbar strain, ~28 days ago, active_treatment
  const sarahInjuryDate = new Date(now.getTime() - 28 * DAY_MS);
  await db.insert(workerCases).values({
    id: CASE_SARAH_ID,
    organizationId: WALLARA_ORG_ID,
    workerId: WORKER_SARAH_ID,
    workerName: "Sarah Chen",
    company: "Wallara",
    dateOfInjury: sarahInjuryDate,
    claimNumber: "WC-WAL-001",
    riskLevel: "Medium",
    workStatus: "Off work",
    hasCertificate: true,
    complianceIndicator: "Medium",
    currentStatus: "Active treatment — week 4 of recovery",
    nextStep: "Draft RTW plan for review",
    owner: "Ellen Burns",
    dueDate: new Date(now.getTime() + 7 * DAY_MS).toISOString().slice(0, 10),
    summary: "Lumbar strain — L4-L5 disc bulge confirmed on MRI. No surgery indicated.",
    ticketIds: [],
    ticketCount: "0",
    lifecycleStage: "active_treatment",
    clinicalStatusJson: { rtwPlanStatus: "not_planned" } as any,
    // Stored compliance is the source of truth for Alex + tooltip. Indicator must
    // always carry a specific reason — never leave reason blank.
    complianceJson: {
      indicator: "Medium",
      reason: "Recovery on track but RTW plan not yet drafted",
      source: "claude",
      lastChecked: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
    } as any,
  } as any);

  // Marcus Tanaka — injury, rotator cuff, ~12 weeks ago, rtw_transition
  const marcusInjuryDate = new Date(now.getTime() - 84 * DAY_MS);
  await db.insert(workerCases).values({
    id: CASE_MARCUS_ID,
    organizationId: WALLARA_ORG_ID,
    workerId: WORKER_MARCUS_ID,
    workerName: "Marcus Tanaka",
    company: "Wallara",
    dateOfInjury: marcusInjuryDate,
    claimNumber: "WC-WAL-002",
    riskLevel: "Low",
    workStatus: "At work",
    hasCertificate: true,
    complianceIndicator: "Low",
    currentStatus: "RTW transition — restricted duties, capacity improving",
    nextStep: "Full duties review in 2 weeks",
    owner: "Ellen Burns",
    dueDate: new Date(now.getTime() + 14 * DAY_MS).toISOString().slice(0, 10),
    summary: "Partial rotator cuff tear — right shoulder. Confirmed on ultrasound + MRI.",
    ticketIds: [],
    ticketCount: "0",
    lifecycleStage: "rtw_transition",
    clinicalStatusJson: { rtwPlanStatus: "in_progress" } as any,
    complianceJson: {
      indicator: "Low",
      reason: "Case file incomplete — missing recent functional capacity update",
      source: "claude",
      lastChecked: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
    } as any,
  } as any);

  // Priya Reddy — preventative, no claim, intake
  await db.insert(workerCases).values({
    id: CASE_PRIYA_ID,
    organizationId: WALLARA_ORG_ID,
    workerId: WORKER_PRIYA_ID,
    workerName: "Priya Reddy",
    company: "Wallara",
    dateOfInjury: new Date(now.getTime() - 14 * DAY_MS), // intake date as proxy
    claimNumber: null,
    riskLevel: "Low",
    workStatus: "At work",
    hasCertificate: false,
    complianceIndicator: "Low",
    currentStatus: "Preventative wellness intake — ergonomic follow-up flagged",
    nextStep: "Schedule ergonomic assessment",
    owner: "Ellen Burns",
    dueDate: new Date(now.getTime() + 10 * DAY_MS).toISOString().slice(0, 10),
    summary: "Preventative intake — wellness check, no active injury or claim.",
    ticketIds: [],
    ticketCount: "0",
    lifecycleStage: "intake",
    complianceJson: {
      indicator: "Low",
      reason: "All baseline checks current",
      source: "claude",
      lastChecked: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    } as any,
  } as any);

  // ── 7. Diagnosis scan attachments ──────────────────────────────────────────
  console.log("[seed-wallara] Inserting diagnosis-scan attachments...");
  await db.insert(caseAttachments).values([
    {
      organizationId: WALLARA_ORG_ID,
      caseId: CASE_SARAH_ID,
      name: "MRI Lumbar Spine — L4-L5 disc bulge",
      type: "diagnosis-scan",
      // Source: https://commons.wikimedia.org/wiki/File:Lumbar_MRI_t2-tse-rst-sagittal_10.jpg (public domain)
      url: scanUrl(
        "https://upload.wikimedia.org/wikipedia/commons/2/20/Lumbar_MRI_t2-tse-rst-sagittal_10.jpg",
        "wallara-sarah-mri",
      ),
    },
    {
      organizationId: WALLARA_ORG_ID,
      caseId: CASE_MARCUS_ID,
      name: "Ultrasound — Right Shoulder",
      type: "diagnosis-scan",
      // Source: https://commons.wikimedia.org/wiki/File:Transversal_US_supraspinatus.jpg (CC BY-SA)
      url: scanUrl(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Transversal_US_supraspinatus.jpg/960px-Transversal_US_supraspinatus.jpg",
        "wallara-marcus-ultrasound",
      ),
    },
    {
      organizationId: WALLARA_ORG_ID,
      caseId: CASE_MARCUS_ID,
      name: "MRI — Right Shoulder rotator cuff",
      type: "diagnosis-scan",
      // Source: https://commons.wikimedia.org/wiki/File:Subacromial_Impingement_with_Supraspinatus_Rupture.jpg (CC BY)
      url: scanUrl(
        "https://upload.wikimedia.org/wikipedia/commons/6/60/Subacromial_Impingement_with_Supraspinatus_Rupture.jpg",
        "wallara-marcus-mri",
      ),
    },
  ] as any);

  // ── 8. Medical certificates (date-aligned to recovery timeline) ────────────
  console.log("[seed-wallara] Inserting medical certificates...");

  // Sarah: 3 certs — week 1 off-work, week 2 off-work, week 4 light duties
  // Current cert (week 4) carries functionalRestrictionsJson so the AutoDraft
  // medical-constraints gate (caseHasMedicalConstraintsGate) passes.
  // Shape: FunctionalRestrictionsExtracted (see shared/schema.ts:1948-1988).
  const sarahWeek4Restrictions: FunctionalRestrictionsExtracted = {
    // Lumbar strain — light duties: limit lifting/bending, allow seated work with rest.
    sitting: "with_modifications",
    standingWalking: "with_modifications",
    bending: "cannot",
    squatting: "cannot",
    kneelingClimbing: "cannot",
    twisting: "cannot",
    reachingOverhead: "with_modifications",
    reachingForward: "can",
    neckMovement: "can",
    lifting: "with_modifications",
    liftingMaxKg: 5,
    carrying: "with_modifications",
    carryingMaxKg: 5,
    pushing: "with_modifications",
    pulling: "with_modifications",
    repetitiveMovements: "with_modifications",
    useOfInjuredLimb: "with_modifications",
    restMinutesPerHour: 10,
    constraintDurationWeeks: 4,
    maxWorkHoursPerDay: 6,
    maxWorkDaysPerWeek: 5,
    extractionConfidence: 0.92,
    extractedAt: now.toISOString(),
  };
  const sarahCerts = [
    {
      weekOffset: 0,
      capacity: "no_work",
      restrictions: [] as Array<{ type: string; description: string }>,
      restrictionsJson: null as FunctionalRestrictionsExtracted | null,
      name: "Initial off-work certificate",
    },
    {
      weekOffset: 1,
      capacity: "no_work",
      restrictions: [],
      restrictionsJson: null,
      name: "Week 2 extension — off-work",
    },
    {
      weekOffset: 3,
      capacity: "modified_duties",
      restrictions: [
        { type: "lifting", description: "No lifting >5kg" },
        { type: "posture", description: "No prolonged sitting >30min" },
      ],
      restrictionsJson: sarahWeek4Restrictions,
      name: "Week 4 — light duties",
    },
  ];
  await db.insert(medicalCertificates).values(
    sarahCerts.map((c) => {
      const start = new Date(sarahInjuryDate.getTime() + c.weekOffset * 7 * DAY_MS);
      const end = new Date(start.getTime() + 7 * DAY_MS);
      return {
        caseId: CASE_SARAH_ID,
        organizationId: WALLARA_ORG_ID,
        workerId: WORKER_SARAH_ID,
        issueDate: start,
        startDate: start,
        endDate: end,
        capacity: c.capacity,
        certificateType: "medical_certificate",
        source: "manual",
        treatingPractitioner: "Dr. Helen Mead",
        practitionerType: "GP",
        clinicName: "Wallara Medical Centre",
        fileName: `sarah-cert-week-${c.weekOffset + 1}.jpg`,
        fileUrl: picsum(`wallara-sarah-cert-${c.weekOffset + 1}`),
        restrictions: c.restrictions,
        functionalRestrictionsJson: c.restrictionsJson,
        isCurrentCertificate: c.weekOffset === 3,
        notes: c.name,
      };
    }) as any
  );

  // Marcus: 4 certs — initial off-work, week 4 off-work, week 8 restricted, week 12 full-duties-with-restrictions
  // Current cert (week 12) carries functionalRestrictionsJson (rotator cuff —
  // no overhead lifting, no repetitive shoulder use, 4kg lift cap, 6h/day).
  const marcusWeek12Restrictions: FunctionalRestrictionsExtracted = {
    sitting: "can",
    standingWalking: "can",
    bending: "can",
    squatting: "can",
    kneelingClimbing: "with_modifications",
    twisting: "with_modifications",
    reachingOverhead: "cannot",
    reachingForward: "with_modifications",
    neckMovement: "can",
    lifting: "with_modifications",
    liftingMaxKg: 4,
    carrying: "with_modifications",
    carryingMaxKg: 4,
    pushing: "with_modifications",
    pulling: "with_modifications",
    repetitiveMovements: "cannot",
    useOfInjuredLimb: "with_modifications",
    constraintDurationWeeks: 4,
    maxWorkHoursPerDay: 6,
    maxWorkDaysPerWeek: 5,
    extractionConfidence: 0.94,
    extractedAt: now.toISOString(),
  };
  // Week 8 — earlier, more restrictive (no overhead, no repetitive shoulder).
  const marcusWeek8Restrictions: FunctionalRestrictionsExtracted = {
    sitting: "can",
    standingWalking: "with_modifications",
    bending: "with_modifications",
    squatting: "with_modifications",
    kneelingClimbing: "cannot",
    twisting: "cannot",
    reachingOverhead: "cannot",
    reachingForward: "with_modifications",
    neckMovement: "can",
    lifting: "with_modifications",
    liftingMaxKg: 2,
    carrying: "with_modifications",
    carryingMaxKg: 2,
    pushing: "cannot",
    pulling: "cannot",
    repetitiveMovements: "cannot",
    useOfInjuredLimb: "cannot",
    constraintDurationWeeks: 4,
    maxWorkHoursPerDay: 4,
    maxWorkDaysPerWeek: 5,
    extractionConfidence: 0.90,
    extractedAt: now.toISOString(),
  };
  const marcusCerts = [
    { weekOffset: 0, capacity: "no_work", name: "Initial off-work certificate", restrictions: [] as Array<{ type: string; description: string }>, restrictionsJson: null as FunctionalRestrictionsExtracted | null },
    { weekOffset: 3, capacity: "no_work", name: "Week 4 extension — off-work", restrictions: [], restrictionsJson: null },
    {
      weekOffset: 7,
      capacity: "modified_duties",
      name: "Week 8 — restricted duties",
      restrictions: [
        { type: "lifting", description: "No overhead lifting" },
        { type: "repetition", description: "No repetitive shoulder use" },
      ],
      restrictionsJson: marcusWeek8Restrictions,
    },
    {
      weekOffset: 11,
      capacity: "modified_duties",
      name: "Week 12 — full duties with restrictions",
      restrictions: [{ type: "lifting", description: "No overhead lifting >5kg" }],
      restrictionsJson: marcusWeek12Restrictions,
    },
  ];
  await db.insert(medicalCertificates).values(
    marcusCerts.map((c) => {
      const start = new Date(marcusInjuryDate.getTime() + c.weekOffset * 7 * DAY_MS);
      const end = new Date(start.getTime() + 28 * DAY_MS);
      return {
        caseId: CASE_MARCUS_ID,
        organizationId: WALLARA_ORG_ID,
        workerId: WORKER_MARCUS_ID,
        issueDate: start,
        startDate: start,
        endDate: end,
        capacity: c.capacity,
        certificateType: "medical_certificate",
        source: "manual",
        treatingPractitioner: "Dr. Helen Mead",
        practitionerType: "Occupational Physician",
        clinicName: "Wallara Medical Centre",
        fileName: `marcus-cert-week-${c.weekOffset + 1}.jpg`,
        fileUrl: picsum(`wallara-marcus-cert-${c.weekOffset + 1}`),
        restrictions: c.restrictions,
        functionalRestrictionsJson: c.restrictionsJson,
        isCurrentCertificate: c.weekOffset === 11,
        notes: c.name,
      };
    }) as any
  );

  // ── 9. RTW plan for Marcus ────────────────────────────────────────────────
  console.log("[seed-wallara] Inserting RTW plan for Marcus...");
  await db.insert(rtwPlans).values({
    id: RTW_PLAN_MARCUS_ID,
    organizationId: WALLARA_ORG_ID,
    caseId: CASE_MARCUS_ID,
    workerId: WORKER_MARCUS_ID,
    planType: "graduated_return",
    status: "approved",
    version: 1,
    pathway: "same_role_modified_duties",
    pathwayRationale:
      "Modified duties to avoid overhead lifting and repetitive shoulder use; suitable duties include admin and supervision.",
    startDate: new Date(now.getTime() - 28 * DAY_MS),
    targetEndDate: new Date(now.getTime() + 28 * DAY_MS),
    createdBy: USER_ELLEN_ID,
  } as any);

  await db.insert(rtwPlanVersions).values({
    id: RTW_PLAN_VERSION_MARCUS_ID,
    planId: RTW_PLAN_MARCUS_ID,
    version: 1,
    dataJson: {
      suitableDuties: ["Administrative tasks", "Supervisory duties", "Training and documentation"],
      restrictedDuties: ["Overhead lifting >5kg", "Repetitive shoulder use"],
      hoursPerWeek: 30,
      reviewSchedule: "Fortnightly",
    },
    createdBy: USER_ELLEN_ID,
    changeReason: "Initial RTW plan",
  } as any);

  // ── 10. Telehealth bookings (exit interviews) ──────────────────────────────
  console.log("[seed-wallara] Inserting telehealth exit bookings for James and Liam...");
  await db.insert(telehealthBookings).values([
    {
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_JAMES_ID,
      workerName: "James O'Brien",
      workerEmail: "james.obrien@wallara.com.au",
      employerName: "Wallara",
      serviceType: "exit",
      appointmentType: "exit_health_check",
      employerNotes: "Exit health check on departure after 3 years of service.",
      status: "completed",
      questionnaireResponses: {
        reasonForLeaving: "Accepted a senior support coordinator role closer to family",
        satisfactionScore: 8,
        wouldRecommend: true,
        managementSupport: "Supportive — Ellen was responsive and made time for monthly 1:1s",
        growthOpportunities: "Adequate — completed manual handling refresher and senior first-aid renewal during tenure",
        feedback: "Loved the team and the participants. Wallara culture is genuine.",
        improvements: "Would value clearer career-pathway documentation for support workers wanting to move into coordination",
        rehireEligible: true,
      },
    },
    {
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_LIAM_ID,
      workerName: "Liam Brennan",
      workerEmail: "liam.brennan@wallara.com.au",
      employerName: "Wallara",
      serviceType: "exit",
      appointmentType: "exit_health_check",
      employerNotes: "Exit health check on departure after 4 years of service.",
      status: "completed",
      createdAt: new Date(now.getTime() - 7 * DAY_MS), // ~1 week ago
      updatedAt: new Date(now.getTime() - 7 * DAY_MS),
      questionnaireResponses: {
        reasonForLeaving: "Returning to postgraduate study in social work full-time",
        satisfactionScore: 9,
        wouldRecommend: true,
        managementSupport: "Excellent — coordinator backed flexible hours during my final units",
        growthOpportunities: "Strong — supported through Cert IV and given lead-coordinator shifts",
        feedback: "Wallara invested in me. Honest feedback culture made a real difference.",
        improvements: "Case-load planning could be smoothed across the fortnight — sometimes uneven week to week",
        rehireEligible: true,
      },
    },
  ] as any);

  // ── 11. Pre-baked morning briefing (coordinator agent job) ─────────────────
  console.log("[seed-wallara] Inserting pre-baked morning briefing agent job...");
  await db.insert(agentJobs).values({
    id: AGENT_JOB_BRIEFING_ID,
    organizationId: WALLARA_ORG_ID,
    caseId: null,
    agentType: "coordinator",
    status: "completed",
    triggeredBy: "cron",
    triggeredByUserId: null,
    summary: BRIEFING_SUMMARY,
    startedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3 hours ago
    completedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000 + 45 * 1000),
  } as any);

  console.log("[seed-wallara] Done. Login: wallara@wallara.com.au / wallara01");
}

export { seedWallara };
export default seedWallara;

// Only auto-run when executed directly as a script.
const isDirectRun =
  process.argv[1]?.endsWith("seed-wallara.ts") ||
  process.argv[1]?.endsWith("seed-wallara.js");

if (isDirectRun) {
  seedWallara()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[seed-wallara] Failed:", err);
      try {
        await pool.end();
      } catch {
        // ignore
      }
      process.exit(1);
    });
}
