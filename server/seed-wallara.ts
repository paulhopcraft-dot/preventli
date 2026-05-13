import "dotenv/config";
import bcrypt from "bcrypt";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { organizations, users } from "@shared/schema";

/**
 * Wallara Group test-login seed.
 *
 * Creates:
 *   - Wallara Group (kind=employer)
 *   - wallara@wallara.com.au  /  wallara01
 *
 * Idempotent: deletes prior Wallara seed rows by stable IDs before re-inserting.
 *
 * Usage:
 *   npm run seed:wallara
 */

const WALLARA_ORG_ID = "org-wallara";
const WALLARA_USER_ID = "user-wallara-primary";

async function seed(): Promise<void> {
  console.log("[seed-wallara] Starting Wallara seed...");

  // Idempotency: clean up prior rows in dependency order.
  console.log("[seed-wallara] Cleaning prior Wallara seed rows...");
  await db.delete(users).where(eq(users.id, WALLARA_USER_ID));
  await db.delete(organizations).where(eq(organizations.id, WALLARA_ORG_ID));

  console.log("[seed-wallara] Inserting Wallara organization...");
  await db.insert(organizations).values({
    id: WALLARA_ORG_ID,
    name: "Wallara Group",
    slug: "wallara",
    kind: "employer",
    contactName: "Wallara Admin",
    contactEmail: "wallara@wallara.com.au",
    contactPhone: "03 9796 2000",
    suburb: "Dandenong",
    state: "VIC",
    postcode: "3175",
    employeeCount: "501-1000",
    notes: "Victorian disability services provider.",
  });

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

  console.log("[seed-wallara] Done.");
  console.log("  Email:    wallara@wallara.com.au");
  console.log("  Password: wallara01");
  console.log("  Role:     employer → lands on / (employer dashboard)");

  await pool.end();
}

seed().catch((err) => {
  console.error("[seed-wallara] Fatal error:", err);
  process.exit(1);
});
