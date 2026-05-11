/**
 * Restrictions API Routes
 * Provides current medical restrictions for RTW planning
 *
 * Requirements: MED-09 (display current restrictions), MED-10 (multi-certificate aggregation)
 */

import { Router } from "express";
import { authorize, type AuthRequest } from "../middleware/auth";
import { requireCaseOwnership } from "../middleware/caseOwnership";
import { storage } from "../storage";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /api/cases/:id/current-restrictions
 * Returns current medical restrictions for RTW planning screen
 *
 * MED-09: Display current restrictions from medical certificates
 * MED-10: Combines multiple active restrictions using "most restrictive wins" logic
 *
 * @param id - Case ID
 * @returns Current restrictions or 404 if none found
 */
router.get(
  "/:id/current-restrictions",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res) => {
    try {
      const caseId = req.params.id as string;
      const organizationId = req.user!.organizationId;

      const result = await storage.getCurrentRestrictions(caseId, organizationId);

      if (!result) {
        return res.status(404).json({
          error: "No current medical certificate with restrictions found",
          hint: "Ensure a valid medical certificate exists with extracted restrictions",
        });
      }

      res.json({
        restrictions: result.restrictions,
        maxWorkHoursPerDay: result.maxWorkHoursPerDay,
        maxWorkDaysPerWeek: result.maxWorkDaysPerWeek,
        source: result.source,
        certificateCount: result.certificateCount,
        retrievedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.api.error("Failed to fetch current restrictions", { caseId: req.params.id }, err);
      res.status(500).json({
        error: "Failed to fetch restrictions",
        details: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }
);

export default router;
