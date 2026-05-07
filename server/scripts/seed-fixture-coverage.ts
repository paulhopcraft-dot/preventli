import { Pool } from "pg";

/**
 * WHT-00d — Ensure the chosen fixture (Daryl Thompson at Alpine Health) has
 * at least one of each event type for the Worker Health Timeline e2e:
 *   - >=1 pre_employment_assessment linked via worker_id
 *   - >=1 worker_case linked via worker_id (already exists post-WHT-00b)
 *   - >=1 medical_certificate linked via the case (and via worker_id)
 *
 * Idempotent: each insert is gated on a count check, so a second run is
 * a no-op.
 *
 * Reads DATABASE_URL from process.env. Never writes secrets.
 */

const FIXTURE_WORKER_ID = "fcb4ba7a-8443-484c-bdd3-6e1ff20e3355"; // Daryl Thompson
const FIXTURE_CASE_ID = "case-org-alpine-health-injury-1"; // Daryl's existing case
const FIXTURE_ORG_ID = "org-alpine-health";

interface Counts {
  assessments: number;
  cases: number;
  certificates: number;
}

async function getCounts(pool: Pool): Promise<Counts> {
  const result = await pool.query<{
    assessments: string;
    cases: string;
    certificates: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM pre_employment_assessments WHERE worker_id = $1) AS assessments,
       (SELECT COUNT(*)::text FROM worker_cases WHERE worker_id = $1) AS cases,
       (SELECT COUNT(*)::text FROM medical_certificates WHERE worker_id = $1) AS certificates`,
    [FIXTURE_WORKER_ID],
  );
  const row = result.rows[0];
  return {
    assessments: Number.parseInt(row.assessments, 10),
    cases: Number.parseInt(row.cases, 10),
    certificates: Number.parseInt(row.certificates, 10),
  };
}

async function seed(pool: Pool): Promise<{ assessmentsAdded: number; certsAdded: number }> {
  const before = await getCounts(pool);
  let assessmentsAdded = 0;
  let certsAdded = 0;

  // 1. Pre-employment assessment — completed, ~6 months ago
  if (before.assessments === 0) {
    await pool.query(
      `INSERT INTO pre_employment_assessments
         (id, organization_id, worker_id, candidate_name, position_title,
          assessment_type, status, completed_date, clearance_level,
          assessor_name, assessor_type)
       VALUES (
         'asmt-fixture-daryl-thompson-001',
         $1, $2, 'Daryl Thompson', 'Care Coordinator',
         'pre_employment', 'completed',
         NOW() - INTERVAL '180 days',
         'fit_for_duties',
         'Dr. Margaret Chen', 'Occupational Physician'
       )`,
      [FIXTURE_ORG_ID, FIXTURE_WORKER_ID],
    );
    assessmentsAdded = 1;
  }

  // 2. Medical certificate — issued ~30 days ago, linked via case_id and worker_id
  if (before.certificates === 0) {
    await pool.query(
      `INSERT INTO medical_certificates
         (id, case_id, issue_date, start_date, end_date, capacity,
          work_capacity_percentage, notes, source, certificate_type,
          organization_id, worker_id, treating_practitioner,
          practitioner_type, clinic_name)
       VALUES (
         'cert-fixture-daryl-thompson-001',
         $1,
         NOW() - INTERVAL '30 days',
         NOW() - INTERVAL '30 days',
         NOW() - INTERVAL '16 days',
         'unfit',
         0,
         'Initial certificate post-injury — total incapacity, lower back strain.',
         'fixture',
         'medical_certificate',
         $2, $3,
         'Dr. Sarah Mitchell',
         'GP',
         'Alpine Family Medical'
       )`,
      [FIXTURE_CASE_ID, FIXTURE_ORG_ID, FIXTURE_WORKER_ID],
    );
    certsAdded = 1;
  }

  return { assessmentsAdded, certsAdded };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const before = await getCounts(pool);
    console.log(
      `[before] assessments=${before.assessments} cases=${before.cases} certificates=${before.certificates}`,
    );

    const result = await seed(pool);
    console.log(
      `[seeded] assessments=+${result.assessmentsAdded} certificates=+${result.certsAdded}`,
    );

    const after = await getCounts(pool);
    console.log(
      `[after] assessments=${after.assessments} cases=${after.cases} certificates=${after.certificates}`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
