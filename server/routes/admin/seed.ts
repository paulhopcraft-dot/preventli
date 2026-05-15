import { Router, type Response } from "express";
import { authorize, type AuthRequest } from "../../middleware/auth";
import { logger } from "../../lib/logger";

const router = Router();

// Admin only
router.use(authorize(["admin"]));

/**
 * POST /api/admin/seed/workbetter
 *
 * One-shot trigger to run the WorkBetter seed on the live server.
 * Admin-only. Safe to call multiple times (seed is idempotent).
 */
router.post("/workbetter", async (_req: AuthRequest, res: Response) => {
  try {
    logger.api.info("[admin/seed] Triggering WorkBetter seed...");
    // Dynamic import so we don't pay the cost at boot time.
    const { seedWorkBetter } = await import("../../seed-workbetter");
    await seedWorkBetter();
    logger.api.info("[admin/seed] WorkBetter seed completed.");
    res.json({ success: true, message: "WorkBetter seed completed." });
  } catch (err) {
    logger.api.error("[admin/seed] Seed failed", {}, err);
    res.status(500).json({ error: "Seed failed", message: String(err) });
  }
});

export default router;
