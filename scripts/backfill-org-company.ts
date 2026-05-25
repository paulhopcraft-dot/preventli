/**
 * Backfill org names for "Unknown Company" rows.
 *
 * Why: until 5920a9b the employer case-creation handler inferred company
 * from the first existing case in the org, so any tenant's very first
 * case fell back to the literal string 'Unknown Company'. Existing rows
 * stay broken unless we patch them up.
 *
 * Safety:
 *   - Only updates rows where company = 'Unknown Company'
 *   - Skips orgs whose name IS literally 'Unknown Company' (would be a
 *     no-op write but we'd rather see the count be 0)
 *   - Idempotent: re-running after a successful pass does nothing
 *
 * Run locally: `npx tsx scripts/backfill-org-company.ts`
 * Run on prod: same command after deploy, with prod DATABASE_URL set.
 */

import "dotenv/config";
import { db } from "../server/db";
import { workerCases, organizations } from "../shared/schema";
import { eq, and, ne, sql } from "drizzle-orm";

async function backfill() {
  console.log("\n🔧 Backfilling worker_cases.company for 'Unknown Company' rows\n");

  // 1) Find every org whose name is NOT 'Unknown Company'.
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(ne(organizations.name, "Unknown Company"));

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const org of orgs) {
    // Count first so we can log non-zero impact only.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workerCases)
      .where(and(eq(workerCases.organizationId, org.id), eq(workerCases.company, "Unknown Company")));

    if (count === 0) {
      totalSkipped++;
      continue;
    }

    await db
      .update(workerCases)
      .set({ company: org.name })
      .where(and(eq(workerCases.organizationId, org.id), eq(workerCases.company, "Unknown Company")));

    console.log(`   ${org.name} (${org.id}): updated ${count} rows`);
    totalUpdated += count;
  }

  console.log(`\n   Updated ${totalUpdated} rows across ${orgs.length - totalSkipped} orgs.`);
  console.log(`   Skipped ${totalSkipped} orgs (no Unknown Company rows).\n`);

  process.exit(0);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
