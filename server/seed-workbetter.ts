import "dotenv/config";
import bcrypt from "bcrypt";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "./db";
import {
  organizations,
  users,
  partnerUserOrganizations,
  workerCases,
} from "@shared/schema";

/**
 * Inline migration SQL — equivalent to migrations/0011_add_partner_tier.sql.
 * Embedded here so seed-workbetter is self-contained and survives Docker
 * builds that don't copy migrations/. Idempotent (uses IF NOT EXISTS).
 */
const PARTNER_TIER_MIGRATION_SQL = `
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'employer' NOT NULL;

ALTER TABLE "worker_cases"
  ADD COLUMN IF NOT EXISTS "claim_number" text;

CREATE TABLE IF NOT EXISTS "partner_user_organizations" (
  "user_id" varchar NOT NULL,
  "organization_id" varchar NOT NULL,
  "granted_at" timestamp DEFAULT now() NOT NULL,
  "granted_by" varchar,
  CONSTRAINT "partner_user_organizations_user_id_organization_id_pk" PRIMARY KEY ("user_id", "organization_id"),
  CONSTRAINT "partner_user_organizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "partner_user_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "partner_user_organizations_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "partner_user_organizations_user_id_idx"
  ON "partner_user_organizations" USING btree ("user_id");
`;

/**
 * Inline migration SQL — equivalent to migrations/0012_partner_client_setup.sql.
 * Slice 2: rich client metadata (insurer, address, contacts, notification emails)
 * so partner users can self-onboard new clients without engineering. All columns
 * nullable. Idempotent.
 */
const PARTNER_CLIENT_SETUP_MIGRATION_SQL = `
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "abn" varchar(11),
  ADD COLUMN IF NOT EXISTS "worksafe_state" text,
  ADD COLUMN IF NOT EXISTS "policy_number" text,
  ADD COLUMN IF NOT EXISTS "wic_code" varchar(20),
  ADD COLUMN IF NOT EXISTS "address_line_1" text,
  ADD COLUMN IF NOT EXISTS "address_line_2" text,
  ADD COLUMN IF NOT EXISTS "suburb" text,
  ADD COLUMN IF NOT EXISTS "state" text,
  ADD COLUMN IF NOT EXISTS "postcode" varchar(4),
  ADD COLUMN IF NOT EXISTS "insurer_claim_contact_email" text,
  ADD COLUMN IF NOT EXISTS "rtw_coordinator_name" text,
  ADD COLUMN IF NOT EXISTS "rtw_coordinator_email" text,
  ADD COLUMN IF NOT EXISTS "rtw_coordinator_phone" varchar(50),
  ADD COLUMN IF NOT EXISTS "hr_contact_name" text,
  ADD COLUMN IF NOT EXISTS "hr_contact_email" text,
  ADD COLUMN IF NOT EXISTS "hr_contact_phone" varchar(50),
  ADD COLUMN IF NOT EXISTS "notification_emails" text,
  ADD COLUMN IF NOT EXISTS "employee_count" text,
  ADD COLUMN IF NOT EXISTS "notes" text;
`;

/**
 * WorkBetter partner-tier seed (Tasks F + G in PLAN.md).
 *
 * Creates:
 *   - WorkBetter (kind=partner)
 *   - Alpine Health (kind=employer)
 *   - Alpine MDF (kind=employer)
 *   - workbetter@workbetter.net.au           — primary partner user, access to BOTH clients
 *   - workbetter-scoped@workbetter.net.au    — scoped partner user, access to Alpine Health only
 *   - 1 smoke case per Alpine company        (Task F minimal)
 *   - 5 demo workers per Alpine company across pre-employment / injury / preventative tracks (Task G)
 *
 * Idempotent: deletes prior partner-tier seed rows by stable IDs before re-inserting.
 *
 * Usage:
 *   npm run seed:workbetter            # full seed (F + G)
 *   npm run seed:workbetter -- --minimal   # F only (skip demo workers)
 */

const PARTNER_ORG_ID = "org-workbetter";
const ALPINE_HEALTH_ID = "org-alpine-health";
const ALPINE_MDF_ID = "org-alpine-mdf";
const ALPINE_TEST_EMPTY_ID = "org-alpine-test-empty";

const PRIMARY_PARTNER_USER_ID = "user-workbetter-primary";
const SCOPED_PARTNER_USER_ID = "user-workbetter-scoped";

const ALPINE_COMPANIES = [
  { id: ALPINE_HEALTH_ID, name: "Alpine Health" },
  { id: ALPINE_MDF_ID, name: "Alpine MDF" },
] as const;

/**
 * WorkBetter's real client roster (extracted from their public client logo wall).
 * Seeded as empty employer orgs so the partner workspace sidebar renders a
 * realistic client list. No worker_cases attached — clicking one shows an
 * empty cases panel by design.
 *
 * Names cleaned best-effort from filename-style source. Add/remove freely;
 * the seed is idempotent and uses deterministic IDs (`org-wb-<slug>`).
 */
const WORKBETTER_CLIENT_NAMES: readonly string[] = [
  "Abacus Energy",
  "Australian Aerospace",
  "Albury Wodonga Midwifery Services",
  "Albury Wodonga Health",
  "AWRCC Trust Fund Inc",
  "Arboressence",
  "Aspire",
  "ATS",
  "Back Straight",
  "BWFCOP",
  "RCB",
  "Benny's Automotive Garage",
  "BH",
  "Border Just Foods",
  "BJS",
  "Border SSP",
  "Bright Brewery",
  "Bright Newsagency",
  "Brown Hill Hotel",
  "Byford Equipment",
  "Centre Against Violence",
  "Clarity & Me OT",
  "Community Accessability",
  "Connex",
  "Corryong Health",
  "Cyclone Infrabuild Wire",
  "DAS",
  "Enhance Physiotherapy",
  "EDS",
  "Exact",
  "Falls Creek Resort",
  "Foresight Engineering",
  "Gateway Health",
  "Gae Long",
  "Grove Steel Solutions",
  "Hargreaves Joinery",
  "Harlo & Co",
  "Hollywoods Cafe Wangaratta",
  "Hume Patient Transport",
  "Hurst Earthmoving",
  "Indigo Power",
  "Indigo Shire",
  "Innovation Steel Frames & Truss",
  "Jones Doyle",
  "JR Mechanical",
  "KBC",
  "KR Hoysted",
  "Lewis Home",
  "Lifeline Albury Wodonga",
  "LRAOR",
  "Luxe Skin Clinic",
  "Mansfield Shire Council",
  "Mawarra Genetics",
  "Mercy Connect",
  "McGrorys Transport",
  "Merriwa Industries",
  "Mitchell Shire Council",
  "Nellen",
  "Net Intellect",
  "NECMA",
  "North East Water",
  "O'Connell's Refrigeration & Air Conditioning",
  "Oedema",
  "One Mile Motors",
  "Our Family Mobile Vet",
  "Pastro",
  "Peter Bowen Homes",
  "Wodonga Turf Club",
  "Rapid Hydraulics",
  "RWT",
  "ROA",
  "Roberson",
  "Roche",
  "RTE Contracting",
  "Rural City of Wangaratta",
  "SafePak",
  "Shine at Business",
  "Skinsational",
  "Smiths TMP",
  "South Albury Trucks",
  "SOCAP",
  "Solar Integrity",
  "Stanton Killeen",
  "Stevnor",
  "Squad",
  "Tailgate Campers",
  "The Centre",
  "The Rural Woman Cooperative",
  "TTA",
  "Tonkin",
  "Top Down Learning",
  "Twenty2 Plumbing",
  "Twin City Electrical & Solar",
  "UHPCP",
  "UMFC",
  "VK Logic",
  "Wangaratta Turf Club",
  "Warrabilla",
  "WAW Bank",
  "Wodonga Beauty Room",
  "W&E Rouse",
  "Winton Wetlands",
  "Wodonga Bowling Club",
  "Wodonga Border Carpets",
  "Women's Centre",
  "Yarrawonga Health",
  "Yield",
];

function slugifyClient(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const WORKBETTER_CLIENTS = WORKBETTER_CLIENT_NAMES.map((name) => {
  const slug = slugifyClient(name);
  return {
    id: `org-wb-${slug}`,
    name,
    slug: `wb-${slug}`,
  };
});

const WORKBETTER_CLIENT_IDS = WORKBETTER_CLIENTS.map((c) => c.id);

interface DemoCase {
  id: string;
  organizationId: string;
  workerName: string;
  company: string;
  track: "pre-employment" | "injury" | "preventative";
  claimNumber: string | null;
  daysAgo: number;
  riskLevel: "High" | "Medium" | "Low";
  workStatus: "At work" | "Off work";
  currentStatus: string;
  nextStep: string;
  /** Short description shown in the workspace cases table column "Injury".
   * For non-injury tracks, describes the case type (e.g. "Pre-employment medical"). */
  injuryDescription: string;
}

/**
 * Demo workers — Australian-sounding names, surnames, and a realistic injury
 * mix per company (clinical/admin for Alpine Health, factory floor for MDF).
 * Hand-curated rather than generated so the demo reads like a real caseload.
 */
const ALPINE_HEALTH_WORKERS: Omit<DemoCase, "organizationId" | "company">[] = [
  {
    id: `case-${ALPINE_HEALTH_ID}-pre-1`,
    workerName: "Bruce Whittaker",
    track: "pre-employment",
    claimNumber: null,
    daysAgo: 5,
    riskLevel: "Low",
    workStatus: "At work",
    currentStatus: "Pre-employment medical pending",
    nextStep: "Collect questionnaire response",
    injuryDescription: "Pre-employment medical — maintenance role",
  },
  {
    id: `case-${ALPINE_HEALTH_ID}-pre-2`,
    workerName: "Megan O'Brien",
    track: "pre-employment",
    claimNumber: null,
    daysAgo: 12,
    riskLevel: "Medium",
    workStatus: "At work",
    currentStatus: "GP review of pre-employment forms",
    nextStep: "Receive doctor sign-off",
    injuryDescription: "Pre-employment medical — allied health role",
  },
  {
    id: `case-${ALPINE_HEALTH_ID}-injury-1`,
    workerName: "Daryl Thompson",
    track: "injury",
    claimNumber: `WC-${ALPINE_HEALTH_ID.slice(-6).toUpperCase()}-001`,
    daysAgo: 30,
    riskLevel: "High",
    workStatus: "Off work",
    currentStatus: "Off work post-injury, awaiting RTW plan",
    nextStep: "Schedule occupational physician review",
    injuryDescription: "Lower back strain — patient-handling lift",
  },
  {
    id: `case-${ALPINE_HEALTH_ID}-injury-2`,
    workerName: "Sharon Cosgrove",
    track: "injury",
    claimNumber: `WC-${ALPINE_HEALTH_ID.slice(-6).toUpperCase()}-002`,
    daysAgo: 60,
    riskLevel: "Medium",
    workStatus: "At work",
    currentStatus: "On modified duties — graded RTW",
    nextStep: "Review week-4 progress",
    injuryDescription: "Right wrist tendinopathy — repetitive task",
  },
  {
    id: `case-${ALPINE_HEALTH_ID}-prev-1`,
    workerName: "Peter Donnelly",
    track: "preventative",
    claimNumber: null,
    daysAgo: 7,
    riskLevel: "Low",
    workStatus: "At work",
    currentStatus: "Annual preventative check scheduled",
    nextStep: "Worker to complete wellness questionnaire",
    injuryDescription: "Annual wellness check",
  },
];

const ALPINE_MDF_WORKERS: Omit<DemoCase, "organizationId" | "company">[] = [
  {
    id: `case-${ALPINE_MDF_ID}-pre-1`,
    workerName: "Wayne Mackenzie",
    track: "pre-employment",
    claimNumber: null,
    daysAgo: 5,
    riskLevel: "Low",
    workStatus: "At work",
    currentStatus: "Pre-employment medical pending",
    nextStep: "Collect questionnaire response",
    injuryDescription: "Pre-employment medical — production line",
  },
  {
    id: `case-${ALPINE_MDF_ID}-pre-2`,
    workerName: "Tracey Mortimer",
    track: "pre-employment",
    claimNumber: null,
    daysAgo: 12,
    riskLevel: "Medium",
    workStatus: "At work",
    currentStatus: "GP review of pre-employment forms",
    nextStep: "Receive doctor sign-off",
    injuryDescription: "Pre-employment medical — forklift operator",
  },
  {
    id: `case-${ALPINE_MDF_ID}-injury-1`,
    workerName: "Steve Henderson",
    track: "injury",
    claimNumber: `WC-${ALPINE_MDF_ID.slice(-6).toUpperCase()}-001`,
    daysAgo: 30,
    riskLevel: "High",
    workStatus: "Off work",
    currentStatus: "Off work post-injury, awaiting RTW plan",
    nextStep: "Schedule occupational physician review",
    injuryDescription: "Crush injury — right hand, panel press",
  },
  {
    id: `case-${ALPINE_MDF_ID}-injury-2`,
    workerName: "Karen Atkinson",
    track: "injury",
    claimNumber: `WC-${ALPINE_MDF_ID.slice(-6).toUpperCase()}-002`,
    daysAgo: 60,
    riskLevel: "Medium",
    workStatus: "At work",
    currentStatus: "On modified duties — graded RTW",
    nextStep: "Review week-4 progress",
    injuryDescription: "Left shoulder impingement — overhead work",
  },
  {
    id: `case-${ALPINE_MDF_ID}-prev-1`,
    workerName: "Trent Bellamy",
    track: "preventative",
    claimNumber: null,
    daysAgo: 7,
    riskLevel: "Low",
    workStatus: "At work",
    currentStatus: "Annual preventative check scheduled",
    nextStep: "Worker to complete wellness questionnaire",
    injuryDescription: "Annual wellness check — hearing screen",
  },
];

function buildDemoCases(): DemoCase[] {
  return [
    ...ALPINE_HEALTH_WORKERS.map((w) => ({
      ...w,
      organizationId: ALPINE_HEALTH_ID,
      company: "Alpine Health",
    })),
    ...ALPINE_MDF_WORKERS.map((w) => ({
      ...w,
      organizationId: ALPINE_MDF_ID,
      company: "Alpine MDF",
    })),
  ];
}

async function seed(): Promise<void> {
  const minimalOnly = process.argv.includes("--minimal");

  console.log("[seed-workbetter] Starting partner-tier seed...");
  if (minimalOnly) console.log("[seed-workbetter] --minimal mode: skipping demo workers (Task G)");

  // Step 0 — apply migrations inline so seed is self-contained.
  // Idempotent (IF NOT EXISTS); safe to run on every invocation.
  console.log("[seed-workbetter] Applying partner-tier migration 0011 (idempotent)...");
  await db.execute(sql.raw(PARTNER_TIER_MIGRATION_SQL));
  console.log("[seed-workbetter] Applying partner-client-setup migration 0012 (idempotent)...");
  await db.execute(sql.raw(PARTNER_CLIENT_SETUP_MIGRATION_SQL));
  console.log("[seed-workbetter] Migrations applied.");

  // Idempotency: clean up any prior partner-tier seed rows by stable IDs.
  // Order matters because of FKs.
  console.log("[seed-workbetter] Cleaning prior partner-tier seed rows...");
  const allClientOrgIds = [
    ALPINE_HEALTH_ID,
    ALPINE_MDF_ID,
    ALPINE_TEST_EMPTY_ID,
    ...WORKBETTER_CLIENT_IDS,
  ];
  await db.delete(workerCases).where(
    inArray(workerCases.organizationId, allClientOrgIds)
  );
  await db.delete(partnerUserOrganizations).where(
    inArray(partnerUserOrganizations.userId, [PRIMARY_PARTNER_USER_ID, SCOPED_PARTNER_USER_ID])
  );
  await db.delete(users).where(
    inArray(users.id, [PRIMARY_PARTNER_USER_ID, SCOPED_PARTNER_USER_ID])
  );
  await db.delete(organizations).where(
    inArray(organizations.id, [PARTNER_ORG_ID, ...allClientOrgIds])
  );

  console.log("[seed-workbetter] Inserting organizations...");
  await db.insert(organizations).values([
    {
      id: PARTNER_ORG_ID,
      name: "WorkBetter",
      slug: "workbetter",
      kind: "partner",
      logoUrl: "/assets/workbetter-logo.jpg",
      contactName: "WorkBetter Admin",
      contactEmail: "admin@workbetter.net.au",
      contactPhone: "03 9000 0001",
    },
    {
      id: ALPINE_HEALTH_ID,
      name: "Alpine Health",
      slug: "alpine-health",
      kind: "employer",
      contactName: "Alpine Health HR",
      contactEmail: "hr@alpinehealth.local",
      contactPhone: "03 9000 0002",
      abn: "12345678901",
      worksafeState: "VIC",
      policyNumber: "VIC-AH-001",
      wicCode: "861100",
      addressLine1: "12 Mountain Road",
      suburb: "Bright",
      state: "VIC",
      postcode: "3741",
      insurerClaimContactEmail: "claims@alpinehealth.local",
      rtwCoordinatorName: "Sam Carter",
      rtwCoordinatorEmail: "sam@alpinehealth.local",
      rtwCoordinatorPhone: "0400 100 100",
      hrContactName: "Pat Yang",
      hrContactEmail: "pat@alpinehealth.local",
      hrContactPhone: "0400 100 200",
      notificationEmails: "alerts@alpinehealth.local, hr@alpinehealth.local",
      employeeCount: "201-500",
      notes: "Regional health service operating across NE Victoria.",
    },
    {
      id: ALPINE_MDF_ID,
      name: "Alpine MDF",
      slug: "alpine-mdf",
      kind: "employer",
      contactName: "Alpine MDF HR",
      contactEmail: "hr@alpinemdf.local",
      contactPhone: "03 9000 0003",
      abn: "98765432109",
      worksafeState: "VIC",
      policyNumber: "VIC-AMDF-002",
      wicCode: "149200",
      addressLine1: "44 Industrial Drive",
      addressLine2: "Building 2",
      suburb: "Wangaratta",
      state: "VIC",
      postcode: "3677",
      insurerClaimContactEmail: "claims@alpinemdf.local",
      rtwCoordinatorName: "Jordan Reilly",
      rtwCoordinatorEmail: "jordan@alpinemdf.local",
      rtwCoordinatorPhone: "0400 200 100",
      hrContactName: "Casey Lee",
      hrContactEmail: "casey@alpinemdf.local",
      hrContactPhone: "0400 200 200",
      notificationEmails: "safety@alpinemdf.local",
      employeeCount: "51-200",
      notes: "Manufacturer of medium-density fibreboard panels.",
    },
    {
      // Edge-case fixture: no insurer, no policy, multiple notification emails.
      // Proves the form/UI handles sparse rows correctly.
      id: ALPINE_TEST_EMPTY_ID,
      name: "Alpine Test Empty",
      slug: "alpine-test-empty",
      kind: "employer",
      contactName: "Test Contact",
      notificationEmails: "alert1@example.com, alert2@example.com, alert3@example.com",
    },
  ]);

  // WorkBetter's real client roster — empty employer orgs so the sidebar looks
  // alive. Inserted in batches to keep query parameter counts under driver limits.
  console.log(`[seed-workbetter] Inserting ${WORKBETTER_CLIENTS.length} WorkBetter clients...`);
  const wbBatchSize = 50;
  for (let i = 0; i < WORKBETTER_CLIENTS.length; i += wbBatchSize) {
    const batch = WORKBETTER_CLIENTS.slice(i, i + wbBatchSize).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      kind: "employer" as const,
    }));
    await db.insert(organizations).values(batch);
  }

  const passwordHash = await bcrypt.hash("workbetter123", 10);

  console.log("[seed-workbetter] Inserting partner users...");
  await db.insert(users).values([
    {
      id: PRIMARY_PARTNER_USER_ID,
      organizationId: PARTNER_ORG_ID,
      email: "workbetter@workbetter.net.au",
      password: passwordHash,
      role: "partner",
      subrole: null,
      companyId: null,
      insurerId: null,
    },
    {
      id: SCOPED_PARTNER_USER_ID,
      organizationId: PARTNER_ORG_ID,
      email: "workbetter-scoped@workbetter.net.au",
      password: passwordHash,
      role: "partner",
      subrole: null,
      companyId: null,
      insurerId: null,
    },
  ]);

  console.log("[seed-workbetter] Granting partner user access to client orgs...");
  // Primary user gets the Alpine fixtures plus every WorkBetter client.
  // Scoped user stays limited to Alpine Health to keep proving access enforcement.
  const primaryGrants = [
    ALPINE_HEALTH_ID,
    ALPINE_MDF_ID,
    ALPINE_TEST_EMPTY_ID,
    ...WORKBETTER_CLIENT_IDS,
  ].map((organizationId) => ({ userId: PRIMARY_PARTNER_USER_ID, organizationId }));
  const grantBatchSize = 100;
  for (let i = 0; i < primaryGrants.length; i += grantBatchSize) {
    await db.insert(partnerUserOrganizations).values(primaryGrants.slice(i, i + grantBatchSize));
  }
  await db.insert(partnerUserOrganizations).values([
    { userId: SCOPED_PARTNER_USER_ID, organizationId: ALPINE_HEALTH_ID },
  ]);

  // Task F: minimal smoke case per company (one trivial open case).
  console.log("[seed-workbetter] Inserting smoke cases (Task F)...");
  const now = new Date();
  await db.insert(workerCases).values([
    {
      id: `case-${ALPINE_HEALTH_ID}-smoke`,
      organizationId: ALPINE_HEALTH_ID,
      workerName: "Lachlan Hughes",
      company: "Alpine Health",
      dateOfInjury: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      claimNumber: "WC-SMOKE-AH-001",
      riskLevel: "Low",
      workStatus: "At work",
      complianceIndicator: "Low",
      currentStatus: "Cleared for full duties — file pending close",
      nextStep: "Verify partner picker can see this case",
      owner: "WorkBetter",
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      summary: "Right ankle sprain — slip on wet floor",
    },
    {
      id: `case-${ALPINE_MDF_ID}-smoke`,
      organizationId: ALPINE_MDF_ID,
      workerName: "Jason Pritchard",
      company: "Alpine MDF",
      dateOfInjury: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000),
      claimNumber: null,
      riskLevel: "Low",
      workStatus: "At work",
      complianceIndicator: "Low",
      currentStatus: "Ergonomic assessment scheduled",
      nextStep: "Verify partner picker can see this case",
      owner: "WorkBetter",
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      summary: "Preventative ergonomic assessment — back-saver review",
    },
  ]);

  // Task G: demo cases — 5 per company across 3 tracks.
  if (!minimalOnly) {
    console.log("[seed-workbetter] Inserting demo cases (Task G)...");
    const demoCases = buildDemoCases();
    await db.insert(workerCases).values(
      demoCases.map((c) => ({
        id: c.id,
        organizationId: c.organizationId,
        workerName: c.workerName,
        company: c.company,
        dateOfInjury: new Date(now.getTime() - c.daysAgo * 24 * 60 * 60 * 1000),
        claimNumber: c.claimNumber,
        riskLevel: c.riskLevel,
        workStatus: c.workStatus,
        complianceIndicator: c.riskLevel,
        currentStatus: c.currentStatus,
        nextStep: c.nextStep,
        owner: "WorkBetter",
        dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        summary: c.injuryDescription,
      }))
    );
  }

  // Quick read-back to confirm.
  const orgRows = await db.select().from(organizations).where(
    inArray(organizations.id, [
      PARTNER_ORG_ID,
      ALPINE_HEALTH_ID,
      ALPINE_MDF_ID,
      ALPINE_TEST_EMPTY_ID,
      ...WORKBETTER_CLIENT_IDS,
    ])
  );
  const userRows = await db.select().from(users).where(eq(users.role, "partner"));
  const grantRows = await db.select().from(partnerUserOrganizations);
  const caseRows = await db.select().from(workerCases).where(
    inArray(workerCases.organizationId, [ALPINE_HEALTH_ID, ALPINE_MDF_ID])
  );

  console.log("\n[seed-workbetter] Done. Counts:");
  console.log(`  organizations (partner+clients): ${orgRows.length}`);
  console.log(`  workbetter client orgs:          ${WORKBETTER_CLIENT_IDS.length}`);
  console.log(`  partner users:                   ${userRows.length}`);
  console.log(`  partner_user_organizations:      ${grantRows.length}`);
  console.log(`  client cases (Alpine Health/MDF): ${caseRows.length}`);

  console.log("\n[seed-workbetter] Login credentials:");
  console.log("  workbetter@workbetter.net.au         / workbetter123  (full access)");
  console.log("  workbetter-scoped@workbetter.net.au  / workbetter123  (Alpine Health only)");
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[seed-workbetter] Failed:", err);
    try {
      await pool.end();
    } catch {
      // ignore
    }
    process.exit(1);
  });
