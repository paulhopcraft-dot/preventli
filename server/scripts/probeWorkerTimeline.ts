import { Pool } from "pg";

/**
 * WHT-00a — Read-only data probe for the Worker Health Timeline backfill.
 *
 * Queries gpnet3 prod to verify:
 *   1. workers rows for "Daryl Thompson" and "Test Newstarter Alpha"
 *   2. worker_cases for both names (by worker_name since worker_id is null)
 *   3. medical_certificates for both (by worker_id and by case_id)
 *   4. pre_employment_assessments for both
 *   5. Sanity: how many of N worker_cases still have worker_id IS NULL
 *
 * Reads DATABASE_URL from the environment. Does not modify any data.
 */

const TARGET_NAMES = ["Daryl Thompson", "Test Newstarter Alpha"] as const;

interface CountRow {
  null_count: string;
  total: string;
}

interface WorkerRow {
  id: string;
  name: string;
  organization_id: string | null;
  email: string | null;
  phone: string | null;
}

interface CaseRow {
  id: string;
  organization_id: string;
  worker_id: string | null;
  worker_name: string;
  current_status: string;
}

interface CertificateRow {
  id: string;
  case_id: string;
  worker_id: string | null;
  organization_id: string | null;
  issue_date: Date;
}

interface AssessmentRow {
  id: string;
  organization_id: string;
  worker_id: string | null;
  candidate_name: string;
  status: string;
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
    console.log("=== WHT-00a: Read-only probe ===\n");

    // (5) Sanity: how many cases still have NULL worker_id
    const sanity = await pool.query<CountRow>(
      `SELECT
         SUM(CASE WHEN worker_id IS NULL THEN 1 ELSE 0 END)::text AS null_count,
         COUNT(*)::text AS total
       FROM worker_cases`,
    );
    console.log(
      `[Sanity] worker_cases with NULL worker_id: ${sanity.rows[0].null_count} / ${sanity.rows[0].total}\n`,
    );

    for (const name of TARGET_NAMES) {
      console.log(`--- ${name} ---`);

      // (1) workers rows
      const workersResult = await pool.query<WorkerRow>(
        `SELECT id, name, organization_id, email, phone
         FROM workers
         WHERE name = $1
         ORDER BY organization_id NULLS LAST`,
        [name],
      );
      console.log(`workers rows: ${workersResult.rowCount}`);
      for (const w of workersResult.rows) {
        console.log(
          `  worker.id=${w.id}  org=${w.organization_id ?? "(null)"}  email=${w.email ?? "(null)"}`,
        );
      }

      // (2) worker_cases by worker_name
      const casesResult = await pool.query<CaseRow>(
        `SELECT id, organization_id, worker_id, worker_name, current_status
         FROM worker_cases
         WHERE worker_name = $1
         ORDER BY created_at NULLS LAST`,
        [name],
      );
      console.log(`worker_cases by worker_name: ${casesResult.rowCount}`);
      for (const c of casesResult.rows) {
        console.log(
          `  case.id=${c.id}  org=${c.organization_id}  worker_id=${c.worker_id ?? "(null)"}  status=${c.current_status}`,
        );
      }

      // (3) medical_certificates — by worker_id (joined to any workers rows above)
      const workerIds = workersResult.rows.map((w) => w.id);
      if (workerIds.length > 0) {
        const certsByWorkerResult = await pool.query<CertificateRow>(
          `SELECT id, case_id, worker_id, organization_id, issue_date
           FROM medical_certificates
           WHERE worker_id = ANY($1::varchar[])
           ORDER BY issue_date DESC NULLS LAST`,
          [workerIds],
        );
        console.log(
          `medical_certificates by worker_id: ${certsByWorkerResult.rowCount}`,
        );
        for (const cert of certsByWorkerResult.rows) {
          console.log(
            `  cert.id=${cert.id}  case_id=${cert.case_id}  worker_id=${cert.worker_id}  issue=${cert.issue_date.toISOString().split("T")[0]}`,
          );
        }
      } else {
        console.log("medical_certificates by worker_id: skipped (no workers rows)");
      }

      // (3b) medical_certificates — by case_id (joined to cases found in step 2)
      const caseIds = casesResult.rows.map((c) => c.id);
      if (caseIds.length > 0) {
        const certsByCaseResult = await pool.query<CertificateRow>(
          `SELECT id, case_id, worker_id, organization_id, issue_date
           FROM medical_certificates
           WHERE case_id = ANY($1::varchar[])
           ORDER BY issue_date DESC NULLS LAST`,
          [caseIds],
        );
        console.log(
          `medical_certificates by case_id: ${certsByCaseResult.rowCount}`,
        );
        for (const cert of certsByCaseResult.rows) {
          console.log(
            `  cert.id=${cert.id}  case_id=${cert.case_id}  worker_id=${cert.worker_id ?? "(null)"}  issue=${cert.issue_date.toISOString().split("T")[0]}`,
          );
        }
      } else {
        console.log("medical_certificates by case_id: skipped (no cases)");
      }

      // (4) pre_employment_assessments — by candidate_name OR by worker_id
      const assessmentsResult = await pool.query<AssessmentRow>(
        `SELECT id, organization_id, worker_id, candidate_name, status
         FROM pre_employment_assessments
         WHERE candidate_name = $1
            OR worker_id = ANY($2::varchar[])
         ORDER BY created_at DESC NULLS LAST`,
        [name, workerIds.length > 0 ? workerIds : ["__none__"]],
      );
      console.log(
        `pre_employment_assessments (by name or worker_id): ${assessmentsResult.rowCount}`,
      );
      for (const a of assessmentsResult.rows) {
        console.log(
          `  assessment.id=${a.id}  org=${a.organization_id}  worker_id=${a.worker_id ?? "(null)"}  candidate=${a.candidate_name}  status=${a.status}`,
        );
      }

      console.log("");
    }
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
