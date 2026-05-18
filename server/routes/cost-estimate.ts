import { Router, type Response } from "express";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { recomputeFor } from "../services/costEstimate";
import { DISCLAIMER } from "../../config/cost-estimate-formula";
import { createLogger } from "../lib/logger";

const log = createLogger("CostEstimateRoute");
const router = Router();

// All cost-estimate access requires authenticated case access.
router.use(authorize(["admin", "employer", "clinician"]));

/**
 * GET /api/cases/:id/cost-estimate
 * Returns the materialized claim cost estimate for a case.
 * Computes-on-read if the row is missing; returns cached row otherwise.
 *
 * Disclaimer (per ADR-0001) is included verbatim in every response.
 */
router.get("/cases/:id/cost-estimate", async (req: AuthRequest, res: Response) => {
  const caseId = req.params.id as string;
  try {
    let row = await storage.getCaseCostEstimate(caseId);
    if (!row) {
      // Compute-on-first-read
      await recomputeFor(caseId);
      row = await storage.getCaseCostEstimate(caseId);
    }
    if (!row) {
      return res.status(404).json({ error: "Cost estimate unavailable", disclaimer: DISCLAIMER });
    }
    res.json({
      caseId: row.caseId,
      estimatedCostDollars: Number(row.estimatedCostDollars),
      baselineDollars: Number(row.baselineDollars),
      components: row.components,
      formulaVersion: row.formulaVersion,
      baselineSource: row.baselineSource,
      calculatedAt: row.calculatedAt,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    log.error("Cost estimate fetch failed", { caseId }, err);
    res.status(500).json({ error: "Failed to fetch cost estimate" });
  }
});

export default router;
