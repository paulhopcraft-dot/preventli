import "dotenv/config";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { db, pool } from "./db";
import {
  workerCases,
  caseAttachments,
  users,
  insurers,
  organizations,
  type CaseCompliance,
} from "@shared/schema";
import { seedWallara } from "./seed-wallara";

type SeedAttachment = {
  name: string;
  type: string;
  url: string;
};

type RiskCategory = "High" | "Medium" | "Low";
type WorkStatus = "At work" | "Off work";

type SeedCase = {
  workerName: string;
  company: string;
  dateOfInjury: string;
  riskLevel: RiskCategory;
  workStatus: WorkStatus;
  compliance: CaseCompliance;
  currentStatus: string;
  nextStep: string;
  owner: string;
  dueDate: string;
  summary: string;
  ticketIds: string[];
  ticketLastUpdatedAt: string;
  clcLastFollowUp: string;
  clcNextFollowUp: string;
  aiSummary: string;
  aiWorkStatusClassification: string;
  attachments: SeedAttachment[];
  clinicalStatusJson?: { rtwPlanStatus?: string };
};

// Fixed UUIDs for key demo cases (stable across restarts, used in e2e tests)
const FIXED_CASE_IDS: Record<string, string> = {
  "Ethan Wells": "f7cd6639-a713-45ba-b5fd-8a0eb42840d8",
};

const employers = [
  { id: "empl-symmetry", name: "Symmetry Manufacturing" },
  { id: "empl-core", name: "Core Industrial Solutions" },
  { id: "empl-harbor", name: "Harbor Logistics" },
  { id: "empl-northwind", name: "Northwind Foods" },
  { id: "empl-apex", name: "Apex Labour Hire" },
] as const;

// Organization IDs for multi-tenant setup
const ORG_ALPHA_ID = "org-alpha";
const ORG_BETA_ID = "org-beta";

// Cases for Org Alpha (Symmetry Manufacturing - employer-focused)
const alphaCases: SeedCase[] = [
  {
    workerName: "Ava Thompson",
    company: employers[0].name,
    dateOfInjury: "2025-01-03T00:00:00.000Z",
    riskLevel: "High",
    workStatus: "Off work",
    compliance: {
      indicator: "High",
      reason: "Surgery scheduled; requires two-step RTW ramp",
      source: "claude",
      lastChecked: "2025-02-10T09:00:00.000Z",
    },
    currentStatus: "Awaiting orthopedic clearance",
    nextStep: "Confirm post-op physio plan",
    owner: "Renee Valdez",
    dueDate: "2025-02-05",
    summary:
      "Shoulder reconstruction following pallet strike. Weekly check-ins keep engagement high.",
    ticketIds: ["FD-43120", "FD-43190"],
    ticketLastUpdatedAt: "2025-02-10T08:20:00.000Z",
    clcLastFollowUp: "2025-01-27",
    clcNextFollowUp: "2025-02-03",
    aiSummary:
      "XGBoost risk index 0.78 warns of relapse without staged duties; maintain weekly coaching.",
    aiWorkStatusClassification: "Off work - post surgery",
    attachments: [
      {
        name: "Medical Certificate - Initial 03 Jan",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/ava-thompson-initial.pdf",
      },
      {
        name: "Medical Certificate - Extension 18 Jan",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/ava-thompson-extension.pdf",
      },
      {
        name: "RTW Plan - Graduated Duties",
        type: "rtw-plan",
        url: "https://files.preventli.local/rtw/ava-thompson-plan.pdf",
      },
      {
        name: "Case Notes - Site Supervisor",
        type: "case-note",
        url: "https://files.preventli.local/notes/ava-thompson-2025-01-20.txt",
      },
    ],
  },
  {
    workerName: "Marcus Reid",
    company: employers[1].name,
    dateOfInjury: "2024-12-19T00:00:00.000Z",
    riskLevel: "Medium",
    workStatus: "At work",
    compliance: {
      indicator: "Medium",
      reason: "Awaiting ergonomic audit sign-off",
      source: "manual",
      lastChecked: "2025-01-28T14:30:00.000Z",
    },
    currentStatus: "Modified forklift duties approved",
    nextStep: "Close loop with insurer nurse",
    owner: "Liam Cortez",
    dueDate: "2025-01-26",
    summary:
      "Lower back strain. Working 4-hour shifts with sit/stand rotation; needs RTW docs filed.",
    ticketIds: ["FD-43210"],
    ticketLastUpdatedAt: "2025-01-28T13:10:00.000Z",
    clcLastFollowUp: "2025-01-21",
    clcNextFollowUp: "2025-01-30",
    aiSummary:
      "XGBoost probability 0.32 indicates stable progress if ergonomics controls stay in place.",
    aiWorkStatusClassification: "At work - modified duties",
    attachments: [
      {
        name: "Medical Certificate - Stabilisation",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/marcus-reid-stabilisation.pdf",
      },
      {
        name: "Case Notes - Shift Debrief",
        type: "case-note",
        url: "https://files.preventli.local/notes/marcus-reid-2025-01-24.txt",
      },
    ],
  },
  {
    workerName: "Noah Bennett",
    company: employers[0].name,
    dateOfInjury: "2025-01-11T00:00:00.000Z",
    riskLevel: "Low",
    workStatus: "At work",
    compliance: {
      indicator: "Medium",
      reason: "Needs fortnightly capacity form",
      source: "manual",
      lastChecked: "2025-02-10T08:00:00.000Z",
    },
    currentStatus: "Working 6-hour shifts",
    nextStep: "Upload GP capacity form",
    owner: "Isla Boyd",
    dueDate: "2025-02-12",
    summary:
      "Mild ankle sprain; worker overseeing training bay and avoiding ladder work per restrictions.",
    ticketIds: ["FD-43455"],
    ticketLastUpdatedAt: "2025-02-10T07:40:00.000Z",
    clcLastFollowUp: "2025-02-06",
    clcNextFollowUp: "2025-02-13",
    aiSummary:
      "XGBoost stability score 0.18 indicates minimal escalation risk once paperwork completed.",
    aiWorkStatusClassification: "At work - reduced hours",
    attachments: [
      {
        name: "Medical Certificate - Duty review",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/noah-bennett-duty.pdf",
      },
      {
        name: "Case Notes - Toolbox Talk",
        type: "case-note",
        url: "https://files.preventli.local/notes/noah-bennett-2025-02-05.txt",
      },
    ],
  },
  {
    workerName: "Ethan Wells",
    company: employers[1].name,
    dateOfInjury: "2024-11-15T00:00:00.000Z",
    riskLevel: "Medium",
    clinicalStatusJson: { rtwPlanStatus: "pending_employer_review" },
    workStatus: "Off work",
    compliance: {
      indicator: "Low",
      reason: "No updated medical received in 6 weeks",
      source: "manual",
      lastChecked: "2025-01-12T09:20:00.000Z",
    },
    currentStatus: "Overdue - chasing medical",
    nextStep: "Arrange GP booking",
    owner: "Jules Kramer",
    dueDate: "2024-11-30",
    summary:
      "Knee injury stuck in limbo; worker unreachable and certificates expired. Needs escalation.",
    ticketIds: ["FD-42940"],
    ticketLastUpdatedAt: "2025-01-12T09:05:00.000Z",
    clcLastFollowUp: "2024-12-22",
    clcNextFollowUp: "2025-01-08",
    aiSummary:
      "XGBoost risk 0.84 suggests probable long-tail cost without immediate contact.",
    aiWorkStatusClassification: "Off work - disengaged",
    attachments: [
      {
        name: "Medical Certificate - Expired",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/ethan-wells-expired.pdf",
      },
      {
        name: "Case Notes - Worksite Attempt",
        type: "case-note",
        url: "https://files.preventli.local/notes/ethan-wells-2024-12-20.txt",
      },
    ],
  },
];

// Cases for Org Beta (Harbor Clinic - clinician-focused)
const betaCases: SeedCase[] = [
  {
    workerName: "Priya Nair",
    company: employers[2].name,
    dateOfInjury: "2025-01-09T00:00:00.000Z",
    riskLevel: "High",
    workStatus: "Off work",
    compliance: {
      indicator: "Very High",
      reason: "Complex fracture requires staged rehabilitation",
      source: "freshdesk",
      lastChecked: "2025-02-12T07:45:00.000Z",
    },
    currentStatus: "In hydrotherapy block",
    nextStep: "Upgrade to light transport duties",
    owner: "Sarah Patel",
    dueDate: "2025-02-18",
    summary:
      "Foot fracture after dock plate collapse; insurer approved RTW stipend pending compliance audit.",
    ticketIds: ["FD-43301", "FD-43325"],
    ticketLastUpdatedAt: "2025-02-11T16:05:00.000Z",
    clcLastFollowUp: "2025-02-05",
    clcNextFollowUp: "2025-02-13",
    aiSummary:
      "XGBoost risk 0.71 flags schedule slip if transport duties not locked in within 10 days.",
    aiWorkStatusClassification: "Off work - graduated duties pending",
    attachments: [
      {
        name: "Medical Certificate - Orthopedic",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/priya-nair-ortho.pdf",
      },
      {
        name: "RTW Plan - Dock Support",
        type: "rtw-plan",
        url: "https://files.preventli.local/rtw/priya-nair-plan.pdf",
      },
      {
        name: "Case Notes - Hydrotherapy Update",
        type: "case-note",
        url: "https://files.preventli.local/notes/priya-nair-2025-02-07.txt",
      },
    ],
  },
  {
    workerName: "Leo Gutierrez",
    company: employers[3].name,
    dateOfInjury: "2025-01-15T00:00:00.000Z",
    riskLevel: "Medium",
    workStatus: "At work",
    compliance: {
      indicator: "High",
      reason: "Food safety training outstanding",
      source: "manual",
      lastChecked: "2025-02-11T10:20:00.000Z",
    },
    currentStatus: "On reduced lifting protocol",
    nextStep: "Document competency sign-off",
    owner: "Kara Mills",
    dueDate: "2025-02-14",
    summary:
      "Hand laceration; sutures removed and worker covering QA console shifts with no gripping tasks.",
    ticketIds: ["FD-43388"],
    ticketLastUpdatedAt: "2025-02-11T11:10:00.000Z",
    clcLastFollowUp: "2025-02-08",
    clcNextFollowUp: "2025-02-15",
    aiSummary:
      "XGBoost risk 0.28 indicates low relapse probability once competency tick completed.",
    aiWorkStatusClassification: "At work - reduced lifting",
    attachments: [
      {
        name: "Medical Certificate - RTW clearance",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/leo-gutierrez-clearance.pdf",
      },
    ],
  },
  {
    workerName: "Harper Lin",
    company: employers[4].name,
    dateOfInjury: "2025-01-05T00:00:00.000Z",
    riskLevel: "Medium",
    workStatus: "Off work",
    compliance: {
      indicator: "High",
      reason: "Awaiting psych clearance for RTW plan",
      source: "claude",
      lastChecked: "2025-02-09T15:02:00.000Z",
    },
    currentStatus: "Participating in RTW case conference",
    nextStep: "Confirm host placement",
    owner: "Darren Ekstrom",
    dueDate: "2025-02-20",
    summary:
      "Psychological injury from customer incident. Voc provider engaged; RTW staged across host employer.",
    ticketIds: ["FD-43410", "FD-43422"],
    ticketLastUpdatedAt: "2025-02-09T13:45:00.000Z",
    clcLastFollowUp: "2025-02-04",
    clcNextFollowUp: "2025-02-18",
    aiSummary:
      "XGBoost resilience score 0.44 suggests positive RTW if host placement confirmed this cycle.",
    aiWorkStatusClassification: "Off work - psychosocial",
    attachments: [
      {
        name: "RTW Plan - Host Placement",
        type: "rtw-plan",
        url: "https://files.preventli.local/rtw/harper-lin-plan.pdf",
      },
      {
        name: "Medical Certificate - Psych Consult",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/harper-lin-psych.pdf",
      },
    ],
  },
  {
    workerName: "Sofia Marin",
    company: employers[2].name,
    dateOfInjury: "2024-11-29T00:00:00.000Z",
    riskLevel: "High",
    workStatus: "Off work",
    compliance: {
      indicator: "Very Low",
      reason: "Overdue case conference actions",
      source: "freshdesk",
      lastChecked: "2025-01-15T12:00:00.000Z",
    },
    currentStatus: "Overdue - awaiting psychiatric review",
    nextStep: "Escalate to insurer specialist",
    owner: "Nate Holloway",
    dueDate: "2024-12-20",
    summary:
      "PTSD following near-miss; worker disengaged and certificates exhausted. Immediate escalation required.",
    ticketIds: ["FD-43002", "FD-43044"],
    ticketLastUpdatedAt: "2025-01-15T11:32:00.000Z",
    clcLastFollowUp: "2025-01-05",
    clcNextFollowUp: "2025-01-19",
    aiSummary:
      "XGBoost risk 0.91 indicates high probability of extended incapacity without psych review.",
    aiWorkStatusClassification: "Off work - overdue",
    attachments: [
      {
        name: "Medical Certificate - Psychiatrist",
        type: "medical-certificate",
        url: "https://files.preventli.local/certificates/sofia-marin-psych.pdf",
      },
      {
        name: "Case Notes - Escalation",
        type: "case-note",
        url: "https://files.preventli.local/notes/sofia-marin-2025-01-10.txt",
      },
    ],
  },
];

async function seed() {
  console.log("Seeding Preventli multi-tenant demo data...");

  // Idempotency guard: skip if data already exists (prevents deploy failures on re-runs)
  const existingUsers = await db.select().from(users).limit(1);
  if (existingUsers.length > 0) {
    console.log("Database already seeded — skipping.");
    return;
  }

  // Clear existing data in correct order (respecting FK constraints)
  await db.delete(caseAttachments);
  await db.delete(workerCases);
  await db.delete(users);
  await db.delete(organizations);
  await db.delete(insurers);

  // Seed insurers
  console.log("Seeding insurers...");
  const insurerData = [
    { id: "ins-dxc", name: "DXC", code: "DXC" },
    { id: "ins-gallagher", name: "Gallagher Bassett", code: "GB" },
    { id: "ins-eml", name: "EML", code: "EML" },
    { id: "ins-allianz", name: "Allianz", code: "ALZ" },
  ];
  await db.insert(insurers).values(insurerData);

  // Seed organizations (multi-tenant setup)
  console.log("Seeding organizations...");
  await db.insert(organizations).values([
    {
      id: ORG_ALPHA_ID,
      name: "Symmetry Manufacturing",
      slug: "symmetry",
      contactName: "Jane Smith",
      contactPhone: "03 9555 1234",
      contactEmail: "admin@symmetry.local",
      insurerId: "ins-gallagher",
    },
    {
      id: ORG_BETA_ID,
      name: "Harbor Clinic",
      slug: "harborclinic",
      contactName: "Dr. Michael Chen",
      contactPhone: "03 9555 5678",
      contactEmail: "admin@harborclinic.local",
      insurerId: "ins-eml",
    },
  ] as any);

  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  // Seed users with proper organization assignments
  console.log("Seeding users...");
  await db.insert(users).values([
    {
      id: randomUUID(),
      organizationId: ORG_ALPHA_ID, // Admin belongs to alpha but can access all
      email: "admin@gpnet.local",
      password: passwordHash,
      role: "admin",
      subrole: null,
      companyId: null,
      insurerId: null,
    },
    {
      id: randomUUID(),
      organizationId: ORG_ALPHA_ID, // Employer in org-alpha
      email: "employer@symmetry.local",
      password: passwordHash,
      role: "employer",
      subrole: "rtw-coordinator",
      companyId: employers[0].id,
      insurerId: null,
    },
    {
      id: randomUUID(),
      organizationId: ORG_BETA_ID, // Doctor in org-beta (different org!)
      email: "doctor@harborclinic.local",
      password: passwordHash,
      role: "clinician",
      subrole: "occupational-physician",
      companyId: null,
      insurerId: null,
    },
    {
      id: randomUUID(),
      organizationId: ORG_ALPHA_ID, // Natalie - employer in org-alpha
      email: "natalie@preventli.com",
      password: passwordHash,
      role: "employer",
      subrole: "rtw-coordinator",
      companyId: employers[0].id,
      insurerId: null,
    },
  ] as any);

  // Seed cases for Org Alpha
  console.log("Seeding cases for Org Alpha (Symmetry Manufacturing)...");
  for (const seedCase of alphaCases) {
    const caseId = FIXED_CASE_IDS[seedCase.workerName] ?? randomUUID();
    const certificateAttachment = seedCase.attachments.find(
      (attachment) => attachment.type === "medical-certificate",
    );

    await db.insert(workerCases).values({
      id: caseId,
      organizationId: ORG_ALPHA_ID,
      workerName: seedCase.workerName,
      company: seedCase.company,
      dateOfInjury: new Date(seedCase.dateOfInjury),
      riskLevel: seedCase.riskLevel,
      workStatus: seedCase.workStatus,
      hasCertificate: Boolean(certificateAttachment),
      certificateUrl: certificateAttachment?.url ?? null,
      complianceIndicator: seedCase.compliance.indicator,
      complianceJson: seedCase.compliance,
      currentStatus: seedCase.currentStatus,
      nextStep: seedCase.nextStep,
      owner: seedCase.owner,
      dueDate: seedCase.dueDate,
      summary: seedCase.summary,
      ticketIds: seedCase.ticketIds,
      ticketCount: String(seedCase.ticketIds.length),
      aiSummary: seedCase.aiSummary,
      aiSummaryGeneratedAt: new Date(),
      aiSummaryModel: "gpnet-xgboost-lab",
      aiWorkStatusClassification: seedCase.aiWorkStatusClassification,
      ticketLastUpdatedAt: new Date(seedCase.ticketLastUpdatedAt),
      clcLastFollowUp: seedCase.clcLastFollowUp,
      clcNextFollowUp: seedCase.clcNextFollowUp,
      clinicalStatusJson: (seedCase as any).clinicalStatusJson ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    if (seedCase.attachments.length > 0) {
      await db.insert(caseAttachments).values(
        seedCase.attachments.map((attachment) => ({
          id: randomUUID(),
          organizationId: ORG_ALPHA_ID,
          caseId,
          name: attachment.name,
          type: attachment.type,
          url: attachment.url,
          createdAt: new Date(),
        })),
      );
    }
  }

  // Seed cases for Org Beta
  console.log("Seeding cases for Org Beta (Harbor Clinic)...");
  for (const seedCase of betaCases) {
    const caseId = randomUUID();
    const certificateAttachment = seedCase.attachments.find(
      (attachment) => attachment.type === "medical-certificate",
    );

    await db.insert(workerCases).values({
      id: caseId,
      organizationId: ORG_BETA_ID,
      workerName: seedCase.workerName,
      company: seedCase.company,
      dateOfInjury: new Date(seedCase.dateOfInjury),
      riskLevel: seedCase.riskLevel,
      workStatus: seedCase.workStatus,
      hasCertificate: Boolean(certificateAttachment),
      certificateUrl: certificateAttachment?.url ?? null,
      complianceIndicator: seedCase.compliance.indicator,
      complianceJson: seedCase.compliance,
      currentStatus: seedCase.currentStatus,
      nextStep: seedCase.nextStep,
      owner: seedCase.owner,
      dueDate: seedCase.dueDate,
      summary: seedCase.summary,
      ticketIds: seedCase.ticketIds,
      ticketCount: String(seedCase.ticketIds.length),
      aiSummary: seedCase.aiSummary,
      aiSummaryGeneratedAt: new Date(),
      aiSummaryModel: "gpnet-xgboost-lab",
      aiWorkStatusClassification: seedCase.aiWorkStatusClassification,
      ticketLastUpdatedAt: new Date(seedCase.ticketLastUpdatedAt),
      clcLastFollowUp: seedCase.clcLastFollowUp,
      clcNextFollowUp: seedCase.clcNextFollowUp,
      clinicalStatusJson: (seedCase as any).clinicalStatusJson ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    if (seedCase.attachments.length > 0) {
      await db.insert(caseAttachments).values(
        seedCase.attachments.map((attachment) => ({
          id: randomUUID(),
          organizationId: ORG_BETA_ID,
          caseId,
          name: attachment.name,
          type: attachment.type,
          url: attachment.url,
          createdAt: new Date(),
        })),
      );
    }
  }

  console.log("\nMulti-tenant demo data inserted successfully!");
  console.log(`  - Org Alpha (${ORG_ALPHA_ID}): ${alphaCases.length} cases`);
  console.log(`  - Org Beta (${ORG_BETA_ID}): ${betaCases.length} cases`);
  console.log("\nTest users:");
  console.log("  - admin@gpnet.local (admin, can access all)");
  console.log("  - employer@symmetry.local (org-alpha only)");
  console.log("  - doctor@harborclinic.local (org-beta only)");
}

seed()
  .then(async () => {
    // Always run Wallara seed — it has its own idempotency guard (delete-then-insert
    // scoped to org-wallara). Wrapped in try/catch so a Wallara-seed failure
    // never blocks Render boot.
    try {
      await seedWallara();
    } catch (wallaraErr) {
      console.error("Wallara seed failed (continuing anyway):", wallaraErr);
    }
  })
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
