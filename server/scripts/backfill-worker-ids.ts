import { Pool } from "pg";

/**
 * WHT-00b — One-shot backfill of worker_cases.worker_id.
 *
 * Steps:
 *   1. UPDATE worker_cases SET worker_id = workers.id
 *      JOIN ON (worker_name = name AND organization_id = organization_id)
 *      WHERE worker_cases.worker_id IS NULL
 *   2. INSERT missing workers rows for distinct (worker_name, organization_id)
 *      where the case still has NULL worker_id after step 1.
 *   3. Re-run step 1 to link the cases to the newly-created workers.
 *
 * Idempotent: a second run reports 0 / 0 / 0.
 *
 * Reads DATABASE_URL from process.env. Never writes secrets.
 */

interface BackfillSummary {
  updated: number;
  created: number;
  skipped: number;
}

async function backfill(pool: Pool): Promise<BackfillSummary> {
  // Step 1: link cases that already have a matching workers row
  const step1 = await pool.query(
    `UPDATE worker_cases AS wc
       SET worker_id = w.id, updated_at = NOW()
       FROM workers AS w
      WHERE wc.worker_id IS NULL
        AND wc.worker_name = w.name
        AND wc.organization_id = w.organization_id`,
  );
  const updatedStep1 = step1.rowCount ?? 0;

  // Step 2: create workers rows for case workers that lack one
  const step2 = await pool.query(
    `INSERT INTO workers (name, organization_id)
       SELECT DISTINCT wc.worker_name, wc.organization_id
         FROM worker_cases wc
        WHERE wc.worker_id IS NULL
          AND wc.worker_name IS NOT NULL
          AND wc.organization_id IS NOT NULL`,
  );
  const created = step2.rowCount ?? 0;

  // Step 3: re-link cases to the newly-created workers
  const step3 = await pool.query(
    `UPDATE worker_cases AS wc
       SET worker_id = w.id, updated_at = NOW()
       FROM workers AS w
      WHERE wc.worker_id IS NULL
        AND wc.worker_name = w.name
        AND wc.organization_id = w.organization_id`,
  );
  const updatedStep3 = step3.rowCount ?? 0;

  // Skipped: cases still NULL after both link passes (e.g., NULL org_id)
  const skippedResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM worker_cases WHERE worker_id IS NULL`,
  );
  const skipped = Number.parseInt(skippedResult.rows[0].count, 10);

  return {
    updated: updatedStep1 + updatedStep3,
    created,
    skipped,
  };
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
    const summary = await backfill(pool);
    console.log(
      `Updated ${summary.updated} cases. Created ${summary.created} workers. Skipped ${summary.skipped} cases (no resolution).`,
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
