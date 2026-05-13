import "dotenv/config";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { organizations, users, workerCases } from "@shared/schema";

/**
 * Wallara Group demo seed — agentic demo login.
 *
 * Creates:
 *   - Wallara Group (kind=employer)
 *   - wallara@wallara.com.au / wallara01
 *   - 6 demo cases across all case types:
 *       1. Pre-employment      — Sarah Mitchell (pending clearance)
 *       2. Injury / WorkCover  — David Nguyen   (OFF WORK, non-compliant ⚠️)
 *       3. Prevention          — Karen Walsh    (overdue wellness check)
 *       4. Exit                — Marcus Chen    (exit health check pending)
 *       5. Mental Health       — Lisa Okafor    (EAP referral, monitoring)
 *       6. RTW Transition      — Teresa Kowalski (returning to modified duties)
 *
 * Idempotent — deletes prior Wallara rows by stable IDs before re-inserting.
 *
 * Usage:
 *   npm run seed:wallara
 */

const WALLARA_ORG_ID   = "org-wallara";
const WALLARA_USER_ID  = "user-wallara-primary";

const CASE_IDS = {
  preEmployment: "case-wallara-pre-employment",
  injury:        "case-wallara-injury-non-compliant",
  prevention:    "case-wallara-prevention",
  exit:          "case-wallara-exit",
  mentalHealth:  "case-wallara-mental-health",
  rtw:           "case-wallara-rtw-transition",
};

async function seed(): Promise<void> {
  console.log("[seed-wallara] Starting Wallara agentic demo seed...");

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
  const dateStr = (d: Date) => d.toISOString().slice(0, 10);

  // ── Idempotency: clean prior rows in FK-safe order ─────────────────────────
  console.log("[seed-wallara] Cleaning prior rows...");
  await db.delete(workerCases).where(
    // delete all cases belonging to the org
    eq(workerCases.organizationId, WALLARA_ORG_ID)
  );
  await db.delete(users).where(eq(users.id, WALLARA_USER_ID));
  await db.delete(organizations).where(eq(organizations.id, WALLARA_ORG_ID));

  // ── Organization ───────────────────────────────────────────────────────────
  console.log("[seed-wallara] Inserting Wallara Group org...");
  await db.insert(organizations).values({
    id: WALLARA_ORG_ID,
    name: "Wallara Group",
    slug: "wallara",
    kind: "employer",
    contactName: "People & Culture Team",
    contactEmail: "people@wallara.com.au",
    contactPhone: "03 9796 2000",
    addressLine1: "1-3 Greens Road",
    suburb: "Dandenong",
    state: "VIC",
    postcode: "3175",
    worksafeState: "VIC",
    policyNumber: "VIC-WAL-2024-001",
    wicCode: "861300",
    rtwCoordinatorName: "Angela Park",
    rtwCoordinatorEmail: "apark@wallara.com.au",
    rtwCoordinatorPhone: "0412 200 300",
    hrContactName: "People & Culture Team",
    hrContactEmail: "people@wallara.com.au",
    notificationEmails: "people@wallara.com.au, safety@wallara.com.au",
    employeeCount: "501-1000",
    notes: "Victorian disability services provider. Circa 800 support workers across Melbourne south-east.",
  });

  // ── User ───────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("wallara01", 10);
  console.log("[seed-wallara] Inserting Wallara user...");
  await db.insert(users).values({
    id: WALLARA_USER_ID,
    organizationId: WALLARA_ORG_ID,
    email: "wallara@wallara.com.au",
    password: passwordHash,
    role: "employer",
    subrole: null,
    companyId: null,
    insurerId: null,
  });

  // ── 6 Demo Cases ───────────────────────────────────────────────────────────
  console.log("[seed-wallara] Inserting 6 demo cases...");

  await db.insert(workerCases).values([

    // 1. PRE-EMPLOYMENT ──────────────────────────────────────────────────────
    {
      id: CASE_IDS.preEmployment,
      organizationId: WALLARA_ORG_ID,
      workerName: "Sarah Mitchell",
      company: "Wallara Group",
      dateOfInjury: daysAgo(3),
      claimNumber: null,
      riskLevel: "Low",
      workStatus: "Pre-employment",
      hasCertificate: false,
      complianceIndicator: "Low",
      complianceJson: {
        indicator: "Low",
        reason: "Pre-employment medical not yet completed. Questionnaire sent — awaiting response.",
        source: "claude",
        lastChecked: now.toISOString(),
      },
      currentStatus: "Pre-employment health questionnaire sent — awaiting completion",
      nextStep: "Follow up with Sarah if no response by " + dateStr(daysFromNow(2)),
      owner: "Angela Park",
      dueDate: dateStr(daysFromNow(5)),
      summary: "Pre-employment medical — Community Support Worker role (Dandenong region). Questionnaire sent 3 days ago. No response yet.",
      aiSummary: "Sarah Mitchell is a new hire for a Community Support Worker role. Her pre-employment health questionnaire was sent 3 days ago and is still outstanding. Role involves manual handling and personal care — physical fitness declaration required before start date. No red flags at this stage; just needs a nudge.",
      lifecycleStage: "assessment",
      caseStatus: "open",
      ticketCount: "1",
    },

    // 2. INJURY — WorkCover, OFF WORK, NON-COMPLIANT ─────────────────────────
    {
      id: CASE_IDS.injury,
      organizationId: WALLARA_ORG_ID,
      workerName: "David Nguyen",
      company: "Wallara Group",
      dateOfInjury: daysAgo(47),
      claimNumber: "WC-WAL-2024-009",
      riskLevel: "High",
      workStatus: "Off work",
      hasCertificate: true,
      complianceIndicator: "Very High",
      complianceJson: {
        indicator: "Very High",
        reason: "Worker has missed 2 medical appointments without explanation. Certificate expired 9 days ago — no renewal lodged. RTW coordinator contact attempts unanswered (3 attempts). Case flagged non-compliant under WorkSafe Victoria guidelines.",
        source: "claude",
        lastChecked: now.toISOString(),
      },
      currentStatus: "⚠️ Non-compliant — expired certificate, missed appointments, no contact",
      nextStep: "URGENT: Issue formal non-compliance notice. Escalate to insurer if no contact by " + dateStr(daysFromNow(2)),
      owner: "Angela Park",
      dueDate: dateStr(daysFromNow(2)),
      summary: "Lower back injury (L4/L5 disc — manual handling incident). WorkCover claim WC-WAL-2024-009. Off work 47 days. Certificate expired. Non-compliant.",
      aiSummary: "David Nguyen sustained a lower back injury (L4/L5 disc prolapse) during a manual handling incident 47 days ago. WorkCover claim WC-WAL-2024-009 is active. He has been off work since the incident. His medical certificate expired 9 days ago with no renewal lodged. He has missed two GP appointments and has not responded to three contact attempts from the RTW coordinator. This case is non-compliant under WorkSafe Victoria guidelines and requires immediate escalation. A formal non-compliance notice should be issued and the insurer notified if contact is not established within 48 hours.",
      lifecycleStage: "active_treatment",
      caseStatus: "open",
      ticketCount: "3",
    },

    // 3. PREVENTION ──────────────────────────────────────────────────────────
    {
      id: CASE_IDS.prevention,
      organizationId: WALLARA_ORG_ID,
      workerName: "Karen Walsh",
      company: "Wallara Group",
      dateOfInjury: daysAgo(180),
      claimNumber: null,
      riskLevel: "Medium",
      workStatus: "At work",
      hasCertificate: false,
      complianceIndicator: "Medium",
      complianceJson: {
        indicator: "Medium",
        reason: "Annual wellness check is 11 days overdue. Karen has a prior history of musculoskeletal strain. Proactive check is due under Wallara's prevention program.",
        source: "claude",
        lastChecked: now.toISOString(),
      },
      currentStatus: "Annual wellness check overdue — 11 days past scheduled date",
      nextStep: "Schedule wellness check with occupational health provider this week",
      owner: "Angela Park",
      dueDate: dateStr(daysFromNow(4)),
      summary: "Preventative wellness check — Community Programs Coordinator. 11 days overdue. Prior musculoskeletal risk noted.",
      aiSummary: "Karen Walsh is a Community Programs Coordinator who coordinates participant activities across 3 sites. Her annual wellness check was due 11 days ago and hasn't been scheduled. She has a prior history of lower back strain (2022) and her role involves moderate physical demands. Catching this early is the whole point of the prevention program — recommend booking an occupational health review this week before it becomes a reactive case.",
      lifecycleStage: "maintenance",
      caseStatus: "open",
      ticketCount: "1",
    },

    // 4. EXIT ────────────────────────────────────────────────────────────────
    {
      id: CASE_IDS.exit,
      organizationId: WALLARA_ORG_ID,
      workerName: "Marcus Chen",
      company: "Wallara Group",
      dateOfInjury: daysAgo(10),
      claimNumber: null,
      riskLevel: "Low",
      workStatus: "At work",
      hasCertificate: false,
      complianceIndicator: "Low",
      complianceJson: {
        indicator: "Low",
        reason: "Exit health check initiated. Worker is departing on good terms. No active claims or outstanding medical requirements.",
        source: "claude",
        lastChecked: now.toISOString(),
      },
      currentStatus: "Exit health check initiated — final day " + dateStr(daysFromNow(10)),
      nextStep: "Send exit health questionnaire link; collect signed clearance before final day",
      owner: "Angela Park",
      dueDate: dateStr(daysFromNow(8)),
      summary: "Exit health check — Senior Support Worker, 8 years service. Departing voluntarily. Final day in " + 10 + " days.",
      aiSummary: "Marcus Chen is a Senior Support Worker with 8 years at Wallara. He is leaving voluntarily and his final day is in 10 days. An exit health check has been initiated to document baseline health status at departure — important for any future workers' compensation claims. The exit questionnaire link needs to be sent and a signed clearance collected before his final day. No active claims or medical issues. Straightforward exit.",
      lifecycleStage: "rtw_transition",
      caseStatus: "open",
      ticketCount: "1",
    },

    // 5. MENTAL HEALTH ───────────────────────────────────────────────────────
    {
      id: CASE_IDS.mentalHealth,
      organizationId: WALLARA_ORG_ID,
      workerName: "Lisa Okafor",
      company: "Wallara Group",
      dateOfInjury: daysAgo(22),
      claimNumber: null,
      riskLevel: "High",
      workStatus: "At work",
      hasCertificate: false,
      complianceIndicator: "High",
      complianceJson: {
        indicator: "High",
        reason: "Worker presenting with signs of burnout and compassion fatigue following a critical incident 22 days ago. EAP referral made. First EAP session not yet booked. Risk of escalation to WorkCover claim if not supported proactively.",
        source: "claude",
        lastChecked: now.toISOString(),
      },
      currentStatus: "EAP referral made — first session not yet booked, 22 days post-incident",
      nextStep: "Confirm EAP booking with Lisa. Consider temporary workload reduction while monitoring.",
      owner: "Angela Park",
      dueDate: dateStr(daysFromNow(3)),
      summary: "Mental health — Complex Support Worker, critical incident 22 days ago. EAP referred. At-risk of escalation.",
      aiSummary: "Lisa Okafor is a Complex Support Worker who was involved in a serious participant incident 22 days ago. She has continued working but is showing signs of burnout and compassion fatigue — reduced engagement, increased sick days, and self-reported stress. An EAP referral was made last week but Lisa has not yet booked her first session. This is a proactive mental health case: early intervention now is far less costly than a WorkCover psychological injury claim later. Recommend a check-in conversation this week and confirming the EAP booking is in the diary.",
      lifecycleStage: "assessment",
      caseStatus: "open",
      ticketCount: "2",
    },

    // 6. RTW TRANSITION ──────────────────────────────────────────────────────
    {
      id: CASE_IDS.rtw,
      organizationId: WALLARA_ORG_ID,
      workerName: "Teresa Kowalski",
      company: "Wallara Group",
      dateOfInjury: daysAgo(63),
      claimNumber: "WC-WAL-2024-007",
      riskLevel: "Medium",
      workStatus: "Modified duties",
      hasCertificate: true,
      complianceIndicator: "Medium",
      complianceJson: {
        indicator: "Medium",
        reason: "RTW plan active and progressing. Current certificate covers modified duties to week 10. Week 8 review due in 5 days — occupational physician sign-off required before full duties return.",
        source: "claude",
        lastChecked: now.toISOString(),
      },
      currentStatus: "Week 8 RTW review due in 5 days — modified duties certified to week 10",
      nextStep: "Confirm week 8 occupational physician appointment. Update RTW plan if capacity changes.",
      owner: "Angela Park",
      dueDate: dateStr(daysFromNow(5)),
      summary: "RTW — Rotator cuff tear (right shoulder), WC-WAL-2024-007. Week 8 of graded RTW. Modified duties. Review due shortly.",
      aiSummary: "Teresa Kowalski tore her right rotator cuff during a participant transfer 63 days ago. WorkCover claim WC-WAL-2024-007 is active. She returned to modified duties (light admin, no overhead reaching) at week 5 and is currently in week 8 of her graded RTW plan. Her current medical certificate covers modified duties through week 10. A week 8 occupational physician review is due in 5 days — this determines whether she progresses to full duties on schedule or requires an extension. Certificate and RTW plan are current; this case is on track but needs the review booked.",
      lifecycleStage: "rtw_transition",
      caseStatus: "open",
      ticketCount: "2",
    },

  ]);

  // ── Verification read-back ─────────────────────────────────────────────────
  const caseRows = await db.select({ id: workerCases.id, name: workerCases.workerName, status: workerCases.currentStatus })
    .from(workerCases)
    .where(eq(workerCases.organizationId, WALLARA_ORG_ID));

  console.log("\n[seed-wallara] Done. Cases seeded:");
  for (const c of caseRows) {
    console.log(`  ${c.name.padEnd(20)} ${c.status.slice(0, 60)}`);
  }
  console.log("\n[seed-wallara] Login:");
  console.log("  Email:    wallara@wallara.com.au");
  console.log("  Password: wallara01");
  console.log("  Role:     employer → / (employer dashboard with Alex)");

  await pool.end();
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-wallara] Fatal error:", err);
    process.exit(1);
  });
