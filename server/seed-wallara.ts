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
  rtwRoles,
  rtwDuties,
  rtwDutyDemands,
  caseContacts,
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
const WORKER_DAVID_ID = "worker-wallara-david";
const WORKER_NAOMI_ID = "worker-wallara-naomi";

const CASE_SARAH_ID = "case-wallara-sarah";
const CASE_MARCUS_ID = "case-wallara-marcus";
const CASE_PRIYA_ID = "case-wallara-priya";
// David Nguyen — chronic 6-month L4-L5 disc injury, IME just received (medico-legal demo).
const CASE_DAVID_ID = "case-wallara-david";
// Naomi Wright — preventative Health & Wellbeing demo case (no injury).
const CASE_NAOMI_ID = "case-wallara-naomi";

const RTW_PLAN_MARCUS_ID = "rtw-plan-wallara-marcus";
const RTW_PLAN_VERSION_MARCUS_ID = "rtw-plan-version-wallara-marcus-v1";

const AGENT_JOB_BRIEFING_ID = "agent-job-wallara-briefing";

// RTW role IDs for the three active workers (DSW / Maintenance / Coordinator).
// Stable IDs so re-seeds replace cleanly and the auto-draft endpoint stays predictable.
const ROLE_DSW_ID = "rtwrole-wallara-dsw";
const ROLE_MAINT_ID = "rtwrole-wallara-maintenance";
const ROLE_COORD_ID = "rtwrole-wallara-coordinator";

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
• Ingested David Nguyen's IME report (Dr Margaret Chen, 08/05/2026) — case-conference recommended within 2 weeks.
• Reviewed certificate expirations across active cases — no urgent renewals today.
• Updated Marcus Tanaka's recovery trend — capacity improving, on track for full duties review in 2 weeks.
• Generated Naomi Wright's GPNet Prevention Check Report from her completed assessment.
• Flagged Sarah Chen's RTW plan as ready to draft (week-4 milestone reached).

Today you should:
• Action David Nguyen's IME — convene case conference, draft modified-duties RTW, initiate vocational reassessment.
• Approve the draft RTW plan for Sarah Chen when ready — medical clearance is in.
• Schedule Naomi's workstation review (Prevention Check recommendation #1).
• Check in with Marcus about the new restricted-duties schedule starting Monday.

Status:
• 3 active injury claims (Sarah, Marcus, David — David is highest priority), 2 preventative cases (Priya, Naomi).
• 1 exit interview completed last week (James O'Brien).
• Compliance: 1 high-risk case (David Nguyen — 6 months off work, no current RTW pathway).

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
    await db.delete(caseContacts).where(inArray(caseContacts.caseId, existingCaseIds));
  }

  await db.delete(telehealthBookings).where(inArray(telehealthBookings.organizationId as any, [WALLARA_ORG_ID]));
  await db.delete(preEmploymentAssessments).where(inArray(preEmploymentAssessments.organizationId, [WALLARA_ORG_ID]));
  await db.delete(workerCases).where(inArray(workerCases.organizationId, [WALLARA_ORG_ID]));
  // workers must clear BEFORE rtwRoles (workers.role_id → rtw_roles.id, no cascade,
  // PG default RESTRICT). rtwDuties cascade-deletes rtwDutyDemands via FK.
  await db.delete(workers).where(inArray(workers.organizationId as any, [WALLARA_ORG_ID]));
  await db.delete(rtwDuties).where(inArray(rtwDuties.organizationId, [WALLARA_ORG_ID]));
  await db.delete(rtwRoles).where(inArray(rtwRoles.organizationId, [WALLARA_ORG_ID]));
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
    preferredName: "Ellen",
    companyId: null,
    insurerId: null,
    isActive: true,
    emailVerified: true,
    emailVerifiedAt: now,
  } as any);

  // ── 3a. RTW roles + duties + duty demands ──────────────────────────────────
  // Required by the auto-draft orchestrator (rtwAutoDrafter.resolveRoleId reads
  // workerCases.preInjuryRoleOverrideId then falls back to workers.roleId). We
  // set both on the active workers/cases below for belt-and-braces. Each role
  // gets 5-6 duties with mixed demand profiles so the calculator can produce
  // a real plan instead of "all duties not suitable".
  console.log("[seed-wallara] Inserting RTW roles, duties, demands...");
  await db.insert(rtwRoles).values([
    {
      id: ROLE_DSW_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Disability Support Worker",
      description: "Direct support for participants — personal care, mobility, community access.",
    },
    {
      id: ROLE_MAINT_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Maintenance Officer",
      description: "Facility upkeep, minor repairs, grounds maintenance across Wallara sites.",
    },
    {
      id: ROLE_COORD_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Support Coordinator",
      description: "Plans participant supports, liaises with families and providers, mostly desk-based.",
    },
  ] as any);

  // Duty IDs are stable so we can attach demands without round-trip lookups.
  const dsw = {
    personalCare: "rtwduty-wallara-dsw-personal-care",
    medication: "rtwduty-wallara-dsw-medication",
    community: "rtwduty-wallara-dsw-community",
    documentation: "rtwduty-wallara-dsw-documentation",
    mobility: "rtwduty-wallara-dsw-mobility",
    cleaning: "rtwduty-wallara-dsw-cleaning",
  };
  const maint = {
    repairs: "rtwduty-wallara-maint-repairs",
    grounds: "rtwduty-wallara-maint-grounds",
    inspection: "rtwduty-wallara-maint-inspection",
    inventory: "rtwduty-wallara-maint-inventory",
    cleaning: "rtwduty-wallara-maint-cleaning",
  };
  const coord = {
    planning: "rtwduty-wallara-coord-planning",
    meetings: "rtwduty-wallara-coord-meetings",
    documentation: "rtwduty-wallara-coord-documentation",
    homeVisits: "rtwduty-wallara-coord-home-visits",
    intake: "rtwduty-wallara-coord-intake",
  };

  await db.insert(rtwDuties).values([
    // Disability Support Worker — mix of physical (heavy) and sedentary (admin).
    { id: dsw.personalCare, roleId: ROLE_DSW_ID, organizationId: WALLARA_ORG_ID, name: "Personal care assistance", description: "Showering, dressing, toileting support.", isModifiable: false },
    { id: dsw.medication, roleId: ROLE_DSW_ID, organizationId: WALLARA_ORG_ID, name: "Medication administration", description: "Prepare and administer scheduled medications.", isModifiable: true },
    { id: dsw.community, roleId: ROLE_DSW_ID, organizationId: WALLARA_ORG_ID, name: "Community access support", description: "Accompany participants on outings — driving, walking, public transport.", isModifiable: true },
    { id: dsw.documentation, roleId: ROLE_DSW_ID, organizationId: WALLARA_ORG_ID, name: "Documentation & reporting", description: "Shift notes, incident reports, NDIS records.", isModifiable: true },
    { id: dsw.mobility, roleId: ROLE_DSW_ID, organizationId: WALLARA_ORG_ID, name: "Mobility & transfer support", description: "Assisted transfers, hoist use, wheelchair pushing.", isModifiable: false },
    { id: dsw.cleaning, roleId: ROLE_DSW_ID, organizationId: WALLARA_ORG_ID, name: "Light household tasks", description: "Light cleaning, laundry, meal prep in participant homes.", isModifiable: true },
    // Maintenance Officer — almost all physical.
    { id: maint.repairs, roleId: ROLE_MAINT_ID, organizationId: WALLARA_ORG_ID, name: "Minor repairs & handyman tasks", description: "Patching, painting, fixture replacement.", isModifiable: false },
    { id: maint.grounds, roleId: ROLE_MAINT_ID, organizationId: WALLARA_ORG_ID, name: "Grounds maintenance", description: "Lawn mowing, edging, garden upkeep.", isModifiable: false },
    { id: maint.inspection, roleId: ROLE_MAINT_ID, organizationId: WALLARA_ORG_ID, name: "Site safety inspections", description: "Walk-around inspections, hazard logging.", isModifiable: true },
    { id: maint.inventory, roleId: ROLE_MAINT_ID, organizationId: WALLARA_ORG_ID, name: "Stock & inventory management", description: "Order parts, log stock movements, reconcile invoices.", isModifiable: true },
    { id: maint.cleaning, roleId: ROLE_MAINT_ID, organizationId: WALLARA_ORG_ID, name: "Deep cleaning rotation", description: "Periodic deep-clean of communal areas, requires bending and reaching.", isModifiable: true },
    // Support Coordinator — almost all desk-based, light demands.
    { id: coord.planning, roleId: ROLE_COORD_ID, organizationId: WALLARA_ORG_ID, name: "Support plan development", description: "Draft and review participant support plans.", isModifiable: true },
    { id: coord.meetings, roleId: ROLE_COORD_ID, organizationId: WALLARA_ORG_ID, name: "Provider & family meetings", description: "Video and phone meetings with stakeholders.", isModifiable: true },
    { id: coord.documentation, roleId: ROLE_COORD_ID, organizationId: WALLARA_ORG_ID, name: "Documentation & NDIS reporting", description: "Progress reports, plan reviews, NDIS submissions.", isModifiable: true },
    { id: coord.homeVisits, roleId: ROLE_COORD_ID, organizationId: WALLARA_ORG_ID, name: "Participant home visits", description: "In-home check-ins, requires driving and stairs.", isModifiable: true },
    { id: coord.intake, roleId: ROLE_COORD_ID, organizationId: WALLARA_ORG_ID, name: "New participant intake", description: "Intake interviews, primarily seated office work.", isModifiable: true },
  ] as any);

  await db.insert(rtwDutyDemands).values([
    // DSW — heavy duties (personal care, mobility) + light duties (documentation).
    { dutyId: dsw.personalCare, bending: "frequently", squatting: "frequently", kneeling: "occasionally", twisting: "frequently", reachingOverhead: "occasionally", reachingForward: "frequently", lifting: "frequently", liftingMaxKg: 25, carrying: "frequently", carryingMaxKg: 25, standing: "frequently", sitting: "occasionally", walking: "frequently", repetitiveMovements: "frequently", concentration: "frequently", stressTolerance: "frequently", workPace: "frequently" },
    { dutyId: dsw.medication, bending: "occasionally", squatting: "never", kneeling: "never", twisting: "never", reachingOverhead: "occasionally", reachingForward: "frequently", lifting: "occasionally", liftingMaxKg: 2, carrying: "occasionally", carryingMaxKg: 2, standing: "frequently", sitting: "occasionally", walking: "frequently", repetitiveMovements: "occasionally", concentration: "constantly", stressTolerance: "frequently", workPace: "frequently" },
    { dutyId: dsw.community, bending: "occasionally", squatting: "occasionally", kneeling: "never", twisting: "occasionally", reachingOverhead: "never", reachingForward: "occasionally", lifting: "occasionally", liftingMaxKg: 10, carrying: "occasionally", carryingMaxKg: 10, standing: "frequently", sitting: "frequently", walking: "frequently", repetitiveMovements: "occasionally", concentration: "frequently", stressTolerance: "frequently", workPace: "frequently" },
    { dutyId: dsw.documentation, bending: "never", squatting: "never", kneeling: "never", twisting: "never", reachingOverhead: "never", reachingForward: "occasionally", lifting: "never", carrying: "never", standing: "occasionally", sitting: "frequently", walking: "occasionally", repetitiveMovements: "frequently", concentration: "constantly", stressTolerance: "occasionally", workPace: "frequently" },
    { dutyId: dsw.mobility, bending: "frequently", squatting: "frequently", kneeling: "frequently", twisting: "frequently", reachingOverhead: "occasionally", reachingForward: "frequently", lifting: "frequently", liftingMaxKg: 30, carrying: "frequently", carryingMaxKg: 30, standing: "frequently", sitting: "occasionally", walking: "frequently", repetitiveMovements: "frequently", concentration: "frequently", stressTolerance: "frequently", workPace: "frequently" },
    { dutyId: dsw.cleaning, bending: "frequently", squatting: "occasionally", kneeling: "occasionally", twisting: "occasionally", reachingOverhead: "occasionally", reachingForward: "frequently", lifting: "occasionally", liftingMaxKg: 10, carrying: "occasionally", carryingMaxKg: 10, standing: "frequently", sitting: "never", walking: "frequently", repetitiveMovements: "frequently", concentration: "occasionally", stressTolerance: "occasionally", workPace: "occasionally" },
    // Maintenance — physical-heavy, inventory is the only sittable duty.
    { dutyId: maint.repairs, bending: "frequently", squatting: "frequently", kneeling: "frequently", twisting: "frequently", reachingOverhead: "frequently", reachingForward: "frequently", lifting: "frequently", liftingMaxKg: 20, carrying: "frequently", carryingMaxKg: 20, standing: "frequently", sitting: "never", walking: "frequently", repetitiveMovements: "frequently", concentration: "frequently", stressTolerance: "occasionally", workPace: "occasionally" },
    { dutyId: maint.grounds, bending: "frequently", squatting: "occasionally", kneeling: "occasionally", twisting: "frequently", reachingOverhead: "occasionally", reachingForward: "frequently", lifting: "frequently", liftingMaxKg: 15, carrying: "frequently", carryingMaxKg: 15, standing: "frequently", sitting: "never", walking: "frequently", repetitiveMovements: "frequently", concentration: "occasionally", stressTolerance: "occasionally", workPace: "occasionally" },
    { dutyId: maint.inspection, bending: "occasionally", squatting: "occasionally", kneeling: "occasionally", twisting: "occasionally", reachingOverhead: "occasionally", reachingForward: "occasionally", lifting: "never", carrying: "never", standing: "frequently", sitting: "occasionally", walking: "frequently", repetitiveMovements: "occasionally", concentration: "frequently", stressTolerance: "occasionally", workPace: "occasionally" },
    { dutyId: maint.inventory, bending: "occasionally", squatting: "never", kneeling: "never", twisting: "never", reachingOverhead: "occasionally", reachingForward: "occasionally", lifting: "occasionally", liftingMaxKg: 5, carrying: "occasionally", carryingMaxKg: 5, standing: "occasionally", sitting: "frequently", walking: "occasionally", repetitiveMovements: "occasionally", concentration: "frequently", stressTolerance: "occasionally", workPace: "occasionally" },
    { dutyId: maint.cleaning, bending: "frequently", squatting: "occasionally", kneeling: "occasionally", twisting: "frequently", reachingOverhead: "frequently", reachingForward: "frequently", lifting: "occasionally", liftingMaxKg: 10, carrying: "occasionally", carryingMaxKg: 10, standing: "frequently", sitting: "never", walking: "frequently", repetitiveMovements: "frequently", concentration: "occasionally", stressTolerance: "occasionally", workPace: "occasionally" },
    // Coordinator — desk-based, all light.
    { dutyId: coord.planning, bending: "never", squatting: "never", kneeling: "never", twisting: "never", reachingOverhead: "never", reachingForward: "occasionally", lifting: "never", carrying: "never", standing: "occasionally", sitting: "frequently", walking: "occasionally", repetitiveMovements: "frequently", concentration: "constantly", stressTolerance: "frequently", workPace: "frequently" },
    { dutyId: coord.meetings, bending: "never", squatting: "never", kneeling: "never", twisting: "never", reachingOverhead: "never", reachingForward: "occasionally", lifting: "never", carrying: "never", standing: "occasionally", sitting: "frequently", walking: "occasionally", repetitiveMovements: "occasionally", concentration: "constantly", stressTolerance: "frequently", workPace: "frequently" },
    { dutyId: coord.documentation, bending: "never", squatting: "never", kneeling: "never", twisting: "never", reachingOverhead: "never", reachingForward: "occasionally", lifting: "never", carrying: "never", standing: "occasionally", sitting: "frequently", walking: "occasionally", repetitiveMovements: "frequently", concentration: "constantly", stressTolerance: "frequently", workPace: "frequently" },
    { dutyId: coord.homeVisits, bending: "occasionally", squatting: "never", kneeling: "never", twisting: "occasionally", reachingOverhead: "never", reachingForward: "occasionally", lifting: "occasionally", liftingMaxKg: 5, carrying: "occasionally", carryingMaxKg: 5, standing: "frequently", sitting: "frequently", walking: "frequently", repetitiveMovements: "occasionally", concentration: "frequently", stressTolerance: "frequently", workPace: "frequently" },
    { dutyId: coord.intake, bending: "never", squatting: "never", kneeling: "never", twisting: "never", reachingOverhead: "never", reachingForward: "occasionally", lifting: "never", carrying: "never", standing: "never", sitting: "frequently", walking: "never", repetitiveMovements: "frequently", concentration: "constantly", stressTolerance: "frequently", workPace: "frequently" },
  ] as any);

  // ── 4. Workers ─────────────────────────────────────────────────────────────
  console.log("[seed-wallara] Inserting 8 workers...");
  await db.insert(workers).values([
    {
      id: WORKER_SARAH_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Sarah Chen",
      email: "sarah.chen@wallara.com.au",
      phone: "0411 111 111",
      roleId: ROLE_DSW_ID,
    },
    {
      id: WORKER_MARCUS_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Marcus Tanaka",
      email: "marcus.tanaka@wallara.com.au",
      phone: "0422 222 222",
      roleId: ROLE_MAINT_ID,
    },
    {
      id: WORKER_PRIYA_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Priya Reddy",
      email: "priya.reddy@wallara.com.au",
      phone: "0433 333 333",
      roleId: ROLE_COORD_ID,
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
    {
      // David Nguyen — Facilities & Maintenance Coordinator, 58yo, 6 months
      // off work with chronic L4-L5 disc injury. IME has just been completed —
      // case awaits employer + insurer next-step decisions.
      id: WORKER_DAVID_ID,
      organizationId: WALLARA_ORG_ID,
      name: "David Nguyen",
      email: "david.nguyen@wallara.com.au",
      phone: "0417 091 066",
      roleId: ROLE_MAINT_ID,
    },
    {
      // Naomi Wright — Support Coordinator, 41yo. No injury. Voluntarily
      // engaged a Prevention Check after flagging fatigue + neck pain in the
      // quarterly pulse survey. Demonstrates Preventli's preventative pathway.
      id: WORKER_NAOMI_ID,
      organizationId: WALLARA_ORG_ID,
      name: "Naomi Wright",
      email: "naomi.wright@wallara.com.au",
      phone: "0477 777 777",
      roleId: ROLE_COORD_ID,
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
    {
      // David Nguyen — completed pre-emp 5 years ago, full clearance.
      id: "preemp-wallara-david",
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_DAVID_ID,
      candidateName: "David Nguyen",
      candidateEmail: "david.nguyen@wallara.com.au",
      positionTitle: "Facilities & Maintenance Coordinator",
      assessmentType: "functional_capacity",
      status: "completed",
      clearanceLevel: "cleared_unconditional",
      completedDate: new Date(now.getTime() - 1825 * DAY_MS), // ~5 years ago
      assessorName: "Dr. Helen Mead",
      assessorType: "Occupational Physician",
    },
    {
      // Naomi Wright — completed pre-emp 2 years ago, full clearance.
      id: "preemp-wallara-naomi",
      organizationId: WALLARA_ORG_ID,
      workerId: WORKER_NAOMI_ID,
      candidateName: "Naomi Wright",
      candidateEmail: "naomi.wright@wallara.com.au",
      positionTitle: "Support Coordinator",
      assessmentType: "baseline_health",
      status: "completed",
      clearanceLevel: "cleared_unconditional",
      completedDate: new Date(now.getTime() - 730 * DAY_MS), // ~2 years ago
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
    preInjuryRoleOverrideId: ROLE_DSW_ID,
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
    preInjuryRoleOverrideId: ROLE_MAINT_ID,
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
    preInjuryRoleOverrideId: ROLE_COORD_ID,
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

  // David Nguyen — chronic L4-L5 disc injury, 6 months off work. IME has just
  // been received (08/05/2026) and the case is awaiting the case-conference
  // decision: continue modified-duties RTW vs vocational reassessment.
  // High compliance pressure: case is overdue for an updated RTW pathway.
  const davidInjuryDate = new Date(now.getTime() - 182 * DAY_MS); // ~6 months
  await db.insert(workerCases).values({
    id: CASE_DAVID_ID,
    organizationId: WALLARA_ORG_ID,
    workerId: WORKER_DAVID_ID,
    workerName: "David Nguyen",
    company: "Wallara",
    dateOfInjury: davidInjuryDate,
    claimNumber: "VWA 24-091847",
    riskLevel: "High",
    workStatus: "Off work",
    hasCertificate: true,
    preInjuryRoleOverrideId: ROLE_MAINT_ID,
    complianceIndicator: "High",
    currentStatus: "IME report received — case conference required",
    nextStep: "Convene case conference with GP, IME, insurer within 2 weeks",
    owner: "Ellen Burns",
    dueDate: new Date(now.getTime() + 14 * DAY_MS).toISOString().slice(0, 10),
    summary:
      "Chronic L4-L5 discogenic low back pain with L5 radiculopathy. Six months off work. IME (Dr Margaret Chen, 08/05/2026) confirms pre-injury role unsuitable; modified-duties RTW recommended with vocational reassessment.",
    ticketIds: [],
    ticketCount: "0",
    lifecycleStage: "active_treatment",
    clinicalStatusJson: { rtwPlanStatus: "not_planned" } as any,
    complianceJson: {
      indicator: "High",
      reason: "Worker off work 6+ months — IME recommends vocational reassessment, no current RTW plan",
      source: "claude",
      lastChecked: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    } as any,
  } as any);

  // Naomi Wright — preventative Health & Wellbeing check. No injury, no claim.
  // Demonstrates Preventli's prevention pathway: pulse-survey-triggered review,
  // GPNet Prevention Check report generated, employer + worker recommendations.
  await db.insert(workerCases).values({
    id: CASE_NAOMI_ID,
    organizationId: WALLARA_ORG_ID,
    workerId: WORKER_NAOMI_ID,
    workerName: "Naomi Wright",
    company: "Wallara",
    dateOfInjury: new Date(now.getTime() - 3 * DAY_MS), // assessment date proxy
    claimNumber: null,
    riskLevel: "Low",
    workStatus: "At work",
    hasCertificate: false,
    preInjuryRoleOverrideId: ROLE_COORD_ID,
    complianceIndicator: "Low",
    currentStatus: "Prevention Check completed — recommendations open",
    nextStep: "Schedule ergonomic workstation review",
    owner: "Ellen Burns",
    dueDate: new Date(now.getTime() + 12 * DAY_MS).toISOString().slice(0, 10),
    summary:
      "Voluntary Prevention Check after pulse-survey flag (fatigue, intermittent neck pain). No clinical findings of concern — moderate ergonomic + psychosocial risk. Targeted preventative interventions recommended.",
    ticketIds: [],
    ticketCount: "0",
    lifecycleStage: "intake",
    complianceJson: {
      indicator: "Low",
      reason: "Prevention Check complete; recommendations awaiting action within review window",
      source: "claude",
      lastChecked: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
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
    {
      // David — MRI confirming L4-L5 disc protrusion (Dec 2025).
      organizationId: WALLARA_ORG_ID,
      caseId: CASE_DAVID_ID,
      name: "MRI Lumbar Spine — L4-L5 disc protrusion with right neural impingement",
      type: "diagnosis-scan",
      url: scanUrl(
        "https://upload.wikimedia.org/wikipedia/commons/2/20/Lumbar_MRI_t2-tse-rst-sagittal_10.jpg",
        "wallara-david-mri",
      ),
    },
    {
      // David — IME report (medico-legal). Anchors timeline + downloads list.
      // Rich content is rendered client-side from shared/medicoLegalReports.ts.
      organizationId: WALLARA_ORG_ID,
      caseId: CASE_DAVID_ID,
      name: "IME Report — Dr Margaret Chen (08/05/2026)",
      type: "medico-legal-report",
      // Demo: report content renders inline from constant. No PDF URL yet — the
      // frontend modal renders the full report from MEDICO_LEGAL_REPORTS[caseId].
      // When the backend generator ships, this URL becomes the persisted .pdf.
      url: "internal://medico-legal-report/case-wallara-david",
    },
    {
      // Naomi — GPNet Prevention Check report. Same pattern as David's IME.
      organizationId: WALLARA_ORG_ID,
      caseId: CASE_NAOMI_ID,
      name: "GPNet Prevention Check Report — Dr Priya Khatri (12/05/2026)",
      type: "prevention-check-report",
      url: "internal://prevention-check-report/case-wallara-naomi",
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

  // David — 5 unfit certs spanning 6 months. Current cert (week 24) carries
  // IME-aligned restrictions so post-conference RTW planning has the data it
  // needs. Earlier certs are no_work (off-work continuation). Demonstrates a
  // chronic case that never got onto a successful RTW pathway.
  const davidWeek24Restrictions: FunctionalRestrictionsExtracted = {
    // IME-aligned: fit for sedentary/light duties only.
    sitting: "with_modifications",
    standingWalking: "with_modifications",
    bending: "cannot",
    squatting: "cannot",
    kneelingClimbing: "cannot",
    twisting: "cannot",
    reachingOverhead: "cannot",
    reachingForward: "with_modifications",
    neckMovement: "can",
    lifting: "with_modifications",
    liftingMaxKg: 5,
    carrying: "with_modifications",
    carryingMaxKg: 5,
    pushing: "cannot",
    pulling: "cannot",
    repetitiveMovements: "with_modifications",
    useOfInjuredLimb: "with_modifications",
    restMinutesPerHour: 10,
    constraintDurationWeeks: 4,
    maxWorkHoursPerDay: 4,
    maxWorkDaysPerWeek: 5,
    extractionConfidence: 0.92,
    extractedAt: now.toISOString(),
  };
  const davidCerts = [
    { weekOffset: 0, capacity: "no_work", name: "Initial off-work certificate", restrictions: [] as Array<{ type: string; description: string }>, restrictionsJson: null as FunctionalRestrictionsExtracted | null },
    { weekOffset: 4, capacity: "no_work", name: "Month 1 review — off-work continuation", restrictions: [], restrictionsJson: null },
    { weekOffset: 12, capacity: "no_work", name: "Month 3 review — off-work, conservative management", restrictions: [], restrictionsJson: null },
    { weekOffset: 20, capacity: "no_work", name: "Month 5 review — off-work, no surgical candidacy", restrictions: [], restrictionsJson: null },
    {
      weekOffset: 24,
      capacity: "modified_duties",
      name: "Month 6 — IME-aligned modified duties (sedentary only)",
      restrictions: [
        { type: "lifting", description: "No lifting >5kg" },
        { type: "posture", description: "Sit-stand workstation; max 4 hrs/day initially" },
        { type: "movement", description: "No bending or stooping below knee level" },
      ],
      restrictionsJson: davidWeek24Restrictions,
    },
  ];
  await db.insert(medicalCertificates).values(
    davidCerts.map((c) => {
      const start = new Date(davidInjuryDate.getTime() + c.weekOffset * 7 * DAY_MS);
      const end = new Date(start.getTime() + 28 * DAY_MS);
      return {
        caseId: CASE_DAVID_ID,
        organizationId: WALLARA_ORG_ID,
        workerId: WORKER_DAVID_ID,
        issueDate: start,
        startDate: start,
        endDate: end,
        capacity: c.capacity,
        certificateType: "medical_certificate",
        source: "manual",
        treatingPractitioner: "Dr. Saravanan Shanmugam",
        practitionerType: "GP",
        clinicName: "Keysborough Family Medical",
        fileName: `david-cert-week-${c.weekOffset}.jpg`,
        fileUrl: picsum(`wallara-david-cert-${c.weekOffset}`),
        restrictions: c.restrictions,
        functionalRestrictionsJson: c.restrictionsJson,
        isCurrentCertificate: c.weekOffset === 24,
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

  // ── 9a. Case contacts (treating GP + specialist + physio + employer) ───────
  // Spread across multiple AU clinics so the demo doesn't read as one provider
  // doing everything. Phone format "03 9XXX XXXX" (VIC). Emails follow
  // firstname.lastname@<clinic>.com.au.
  console.log("[seed-wallara] Inserting case contacts...");
  await db.insert(caseContacts).values([
    // ── Sarah Chen — lumbar strain (GP + MRI specialist + employer) ─────────
    {
      caseId: CASE_SARAH_ID,
      organizationId: WALLARA_ORG_ID,
      role: "treating_gp",
      name: "Dr. Helen Mead",
      phone: "03 9412 6700",
      email: "helen.mead@bridgestreetclinic.com.au",
      company: "Bridge Street Medical Clinic",
      isPrimary: true,
      isActive: true,
    },
    {
      caseId: CASE_SARAH_ID,
      organizationId: WALLARA_ORG_ID,
      role: "specialist",
      name: "Dr. Anand Krishnan",
      phone: "03 9650 2100",
      email: "anand.krishnan@melbournespine.com.au",
      company: "Melbourne Spine & Pain Centre",
      notes: "Reviewed MRI L4-L5 disc bulge — conservative management, no surgical indication.",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_SARAH_ID,
      organizationId: WALLARA_ORG_ID,
      role: "case_manager",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_SARAH_ID,
      organizationId: WALLARA_ORG_ID,
      role: "employer_primary",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },

    // ── Marcus Tanaka — rotator cuff (GP + specialist + physio + employer) ──
    {
      caseId: CASE_MARCUS_ID,
      organizationId: WALLARA_ORG_ID,
      role: "treating_gp",
      name: "Dr. Rachel Okonkwo",
      phone: "03 9387 4422",
      email: "rachel.okonkwo@brunswickfamilymedical.com.au",
      company: "Brunswick Family Medical",
      isPrimary: true,
      isActive: true,
    },
    {
      caseId: CASE_MARCUS_ID,
      organizationId: WALLARA_ORG_ID,
      role: "specialist",
      name: "Dr. James Patterson",
      phone: "03 9527 8800",
      email: "james.patterson@victoriaorthopaedic.com.au",
      company: "Victoria Orthopaedic Group",
      notes: "Partial supraspinatus tear — conservative management, physiotherapy-led recovery.",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_MARCUS_ID,
      organizationId: WALLARA_ORG_ID,
      role: "physiotherapist",
      name: "Sophie Nguyen",
      phone: "03 9482 1145",
      email: "sophie.nguyen@northsidephysio.com.au",
      company: "Northside Physiotherapy",
      notes: "Weekly sessions — shoulder stability and progressive loading.",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_MARCUS_ID,
      organizationId: WALLARA_ORG_ID,
      role: "case_manager",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_MARCUS_ID,
      organizationId: WALLARA_ORG_ID,
      role: "employer_primary",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },

    // ── Priya Reddy — preventative (GP + employer, no specialists) ──────────
    {
      caseId: CASE_PRIYA_ID,
      organizationId: WALLARA_ORG_ID,
      role: "treating_gp",
      name: "Dr. Marcus Hayward",
      phone: "03 9533 6611",
      email: "marcus.hayward@clarendonmedical.com.au",
      company: "Clarendon Street Medical",
      isPrimary: true,
      isActive: true,
    },
    {
      caseId: CASE_PRIYA_ID,
      organizationId: WALLARA_ORG_ID,
      role: "case_manager",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_PRIYA_ID,
      organizationId: WALLARA_ORG_ID,
      role: "employer_primary",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },

    // ── David Nguyen — chronic L4-L5 (GP + neurosurgeon + physio + IME + insurer + employer) ──
    {
      caseId: CASE_DAVID_ID,
      organizationId: WALLARA_ORG_ID,
      role: "treating_gp",
      name: "Dr. Saravanan Shanmugam",
      phone: "03 9112 8950",
      email: "s.shanmugam@keysboroughfamilymedical.com.au",
      company: "Keysborough Family Medical",
      isPrimary: true,
      isActive: true,
    },
    {
      caseId: CASE_DAVID_ID,
      organizationId: WALLARA_ORG_ID,
      role: "specialist",
      name: "Mr. Arjun Patel",
      phone: "03 9614 7700",
      email: "arjun.patel@melbourneneurosurgery.com.au",
      company: "Melbourne Neurosurgery",
      notes: "Reviewed Feb 2026 — L4-L5 disc protrusion, conservative management only, not a surgical candidate.",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_DAVID_ID,
      organizationId: WALLARA_ORG_ID,
      role: "physiotherapist",
      name: "Laura Donnelly",
      phone: "03 5941 3688",
      email: "laura.donnelly@dandenongphysio.com.au",
      company: "Dandenong Physiotherapy",
      notes: "Weekly hands-on + home-program; tolerance plateaued, no recent gains.",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_DAVID_ID,
      organizationId: WALLARA_ORG_ID,
      role: "specialist",
      name: "Dr. Margaret Chen",
      phone: "03 9650 4500",
      email: "m.chen@collinsoccmed.com.au",
      company: "Collins Street Occupational Medicine",
      notes: "Independent Medical Examiner (IME) — report dated 08/05/2026. Recommends modified-duties RTW + vocational reassessment.",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_DAVID_ID,
      organizationId: WALLARA_ORG_ID,
      role: "case_manager",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_DAVID_ID,
      organizationId: WALLARA_ORG_ID,
      role: "employer_primary",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },

    // ── Naomi Wright — preventative (GP + occupational physician + employer) ──
    {
      caseId: CASE_NAOMI_ID,
      organizationId: WALLARA_ORG_ID,
      role: "treating_gp",
      name: "Dr. Rebecca Tran",
      phone: "03 9388 2200",
      email: "rebecca.tran@northcotefamilymedical.com.au",
      company: "Northcote Family Medical",
      isPrimary: true,
      isActive: true,
    },
    {
      caseId: CASE_NAOMI_ID,
      organizationId: WALLARA_ORG_ID,
      role: "specialist",
      name: "Dr. Priya Khatri",
      phone: "03 9602 7700",
      email: "p.khatri@queenstreetoccmed.com.au",
      company: "Queen Street Occupational Medicine",
      notes: "Conducted Prevention Check assessment 12/05/2026 — moderate ergonomic + psychosocial risk, low clinical concern.",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_NAOMI_ID,
      organizationId: WALLARA_ORG_ID,
      role: "case_manager",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },
    {
      caseId: CASE_NAOMI_ID,
      organizationId: WALLARA_ORG_ID,
      role: "employer_primary",
      name: "Ellen Burns",
      phone: "03 9000 9000",
      email: "wallara@wallara.com.au",
      company: "Wallara",
      isPrimary: false,
      isActive: true,
    },
  ] as any);

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
