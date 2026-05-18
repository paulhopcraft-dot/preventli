import { Router, type Response } from "express";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { DISCLAIMER } from "../../config/cost-estimate-formula";
import { createLogger } from "../lib/logger";

const log = createLogger("PortfolioCostRoute");
const router = Router();

// Org-scoped aggregate. Same role gate as case-level cost estimate.
router.use(authorize(["admin", "employer", "clinician"]));

/**
 * GET /api/cases/portfolio-cost-summary
 * Returns org-wide estimated claim cost aggregate.
 *
 * trendVsPriorMonth is intentionally 0 as a v2 placeholder —
 * historical snapshots are not yet stored.
 *
 * Disclaimer (per ADR-0001) is included verbatim in every response.
 */
router.get("/cases/portfolio-cost-summary", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "No organization scope" });
    }
    const [stats, totalEstimated] = await Promise.all([
      storage.getOrgCaseCostStats(orgId),
      storage.getOrgTotalEstimatedCost(orgId),
    ]);
    res.json({
      orgId,
      caseCount: stats.caseCount,
      totalEstimatedCostDollars: totalEstimated,
      avgPerCaseDollars: stats.avgCaseCostDollars ?? 0,
      trendVsPriorMonth: 0, // v2 placeholder — needs historical snapshot table
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    log.error("Portfolio cost summary failed", {}, err);
    res.status(500).json({ error: "Failed to fetch portfolio cost summary", disclaimer: DISCLAIMER });
  }
});

export default router;
