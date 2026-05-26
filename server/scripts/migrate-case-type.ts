/**
 * One-off migration: add `type` and `assessment_id` columns to worker_cases
 * Run: npx tsx server/scripts/migrate-case-type.ts
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Running migration: add type + assessment_id to worker_cases...");

  await db.execute(sql`
    ALTER TABLE worker_cases
      ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'injury',
      ADD COLUMN IF NOT EXISTS assessment_id varchar
  `);

  const result = await db.execute(sql`
    SELECT type, COUNT(*) as count FROM worker_cases GROUP BY type
  `);

  console.log("Migration complete. Type distribution:", result.rows);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
