import { Pool } from "pg";

/**
 * WHT-00d helper — probe fixture coverage post-backfill.
 *
 * Checks:
 *  1. Per-fixture (Daryl Thompson, Test Newstarter Alpha) counts of
 *     assessments / cases / certificates (via worker_id and via case_id).
 *  2. Top 10 workers by combined event count, to flag a richer alternative
 *     fixture if neither candidate is suitable.
 *  3. Ambiguity check: any (worker_name, organization_id) pair that maps to
 *     >1 workers row (post-backfill follow-up).
 *
 * Read-only. Reads DATABASE_URL from process.env.
 */

const FIXTURE_NAMES = ["Daryl Thompson", "Test Newstarter Alpha"] as const;

interface CoverageRow {
  name: string;
  worker_id: string;
  organization_id: string | null;
  assessments: string;
  cases: string;
  certificates_via_workerid: string;
  certificates_via_case: string;
}

interface RichWorkerRow {
  id: string;
  name: string;
  organization_id: string | null;
  events: string;
  cases: string;
  certs: string;
  assessments: string;
}

interface AmbiguityRow {
  worker_name: string;
  organization_id: string;
  workers_count: string;
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
    console.log("=== WHT-00d: Fixture coverage probe ===\n");

    // (1) Per-fixture coverage
    const coverageQuery = `
      SELECT
        w.name,
        w.id::text AS worker_id,
        w.organization_id,
        (SELECT COUNT(*)::text FROM pre_employment_assessments WHERE worker_id = w.id) AS assessments,
        (SELECT COUNT(*)::text FROM worker_cases WHERE worker_id = w.id) AS cases,
        (SELECT COUNT(*)::text FROM medical_certificates WHERE worker_id = w.id) AS certificates_via_workerid,
        (SELECT COUNT(*)::text FROM medical_certificates mc JOIN worker_cases wc ON mc.case_id = wc.id WHERE wc.worker_id = w.id) AS certificates_via_case
      FROM workers w
      WHERE w.name = ANY($1::text[])
      ORDER BY w.name, w.organization_id NULLS LAST
    `;
    const coverage = await pool.query<CoverageRow>(coverageQuery, [
      FIXTURE_NAMES as unknown as string[],
    ]);
    console.log("[Fixture coverage]");
    for (const row of coverage.rows) {
      console.log(
        `  ${row.name} (id=${row.worker_id}, org=${row.organization_id ?? "(null)"})`,
      );
      console.log(
        `    assessments=${row.assessments}  cases=${row.cases}  certs(via workerId)=${row.certificates_via_workerid}  certs(via caseId)=${row.certificates_via_case}`,
      );
    }
    console.log("");

    // (2) Top 10 workers by combined event count
    const richWorkersQuery = `
      WITH worker_events AS (
        SELECT
          w.id,
          w.name,
          w.organization_id,
          (SELECT COUNT(*) FROM pre_employment_assessments WHERE worker_id = w.id) AS assessments,
          (SELECT COUNT(*) FROM worker_cases WHERE worker_id = w.id) AS cases,
          (SELECT COUNT(*) FROM medical_certificates WHERE worker_id = w.id) AS certs
        FROM workers w
      )
      SELECT
        id::text,
        name,
        organization_id,
        (assessments + cases + certs)::text AS events,
        cases::text AS cases,
        certs::text AS certs,
        assessments::text AS assessments
      FROM worker_events
      WHERE assessments > 0 OR cases > 0 OR certs > 0
      ORDER BY (assessments + cases + certs) DESC, name
      LIMIT 15
    `;
    const richWorkers = await pool.query<RichWorkerRow>(richWorkersQuery);
    console.log("[Top workers by event count]");
    console.log(
      "  name                                 | org                    | total | cases | certs | asmts | id",
    );
    for (const row of richWorkers.rows) {
      console.log(
        `  ${row.name.padEnd(36)} | ${(row.organization_id ?? "(null)").padEnd(22)} | ${row.events.padStart(5)} | ${row.cases.padStart(5)} | ${row.certs.padStart(5)} | ${row.assessments.padStart(5)} | ${row.id}`,
      );
    }
    console.log("");

    // (3) Workers that have >=1 of each event type
    const tripleQuery = `
      WITH worker_events AS (
        SELECT
          w.id,
          w.name,
          w.organization_id,
          (SELECT COUNT(*) FROM pre_employment_assessments WHERE worker_id = w.id) AS assessments,
          (SELECT COUNT(*) FROM worker_cases WHERE worker_id = w.id) AS cases,
          (SELECT COUNT(*) FROM medical_certificates WHERE worker_id = w.id) AS certs
        FROM workers w
      )
      SELECT
        id::text,
        name,
        organization_id,
        cases::text AS cases,
        certs::text AS certs,
        assessments::text AS assessments,
        (assessments + cases + certs)::text AS events
      FROM worker_events
      WHERE assessments >= 1 AND cases >= 1 AND certs >= 1
      ORDER BY (assessments + cases + certs) DESC
    `;
    const triples = await pool.query<RichWorkerRow>(tripleQuery);
    console.log(`[Workers with >=1 of each event type]: ${triples.rowCount}`);
    for (const row of triples.rows) {
      console.log(
        `  ${row.name} | org=${row.organization_id ?? "(null)"} | cases=${row.cases} certs=${row.certs} asmts=${row.assessments} | id=${row.id}`,
      );
    }
    console.log("");

    // (4) Ambiguity: (name, org) pairs that map to >1 workers row
    const ambiguityQuery = `
      SELECT
        wc.worker_name,
        wc.organization_id,
        COUNT(DISTINCT w.id)::text AS workers_count
      FROM worker_cases wc
      JOIN workers w ON w.name = wc.worker_name AND w.organization_id = wc.organization_id
      GROUP BY wc.worker_name, wc.organization_id
      HAVING COUNT(DISTINCT w.id) > 1
    `;
    const ambiguity = await pool.query<AmbiguityRow>(ambiguityQuery);
    console.log(`[Ambiguity check] (name, org) pairs with >1 workers: ${ambiguity.rowCount}`);
    for (const row of ambiguity.rows) {
      console.log(
        `  worker_name="${row.worker_name}" org=${row.organization_id} count=${row.workers_count}`,
      );
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
