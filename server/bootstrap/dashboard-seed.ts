/**
 * Idempotent boot-time seed for the dashboard-integration `Node` table.
 *
 * Runs once on server startup. Inserts the 2 root-level rows that
 * preventli-dashboard's queries expect (business → product → cards).
 * `ON CONFLICT DO NOTHING` makes it safe to re-run forever.
 *
 * This sidesteps the fact that `drizzle-kit push` (Render's build command)
 * applies DDL but skips the INSERT statements in our SQL migrations.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { createLogger } from "../lib/logger";

const log = createLogger("DashboardSeed");

const BUSINESS_ID = process.env.PREVENTLI_BUSINESS_NODE_ID ?? "cmn5cg9em000fd74nmfuxd953";
const PRODUCT_ID = process.env.PREVENTLI_PRODUCT_NODE_ID ?? "preventli-app";

export async function seedDashboardRoots(): Promise<void> {
  try {
    // Quick existence check first — keeps the boot log clean when already seeded.
    const tableExists = await db.execute(
      sql`SELECT to_regclass('public."Node"') IS NOT NULL AS exists`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (tableExists as any)?.rows?.[0]?.exists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?? (tableExists as any)?.[0]?.exists
      ?? false;
    if (!exists) {
      log.info("Node table not present yet — skipping seed (drizzle:push will create it on next boot)");
      return;
    }

    await db.execute(sql`
      INSERT INTO "Node" ("id", "type", "parent_id", "title", "status", "priority", "created_at", "updated_at")
      VALUES
        (${BUSINESS_ID}, 'business', NULL, 'Preventli', 'open', 0, NOW(), NOW()),
        (${PRODUCT_ID}, 'product', ${BUSINESS_ID}, 'Preventli App', 'open', 0, NOW(), NOW())
      ON CONFLICT ("id") DO NOTHING
    `);

    log.info("Dashboard root nodes ensured", { businessId: BUSINESS_ID, productId: PRODUCT_ID });
  } catch (err) {
    // Non-fatal — the dashboard chat endpoint will surface a clearer error if it
    // hits a missing parent row at runtime.
    log.warn("Dashboard seed failed (non-fatal)", {}, err as Error);
  }
}
