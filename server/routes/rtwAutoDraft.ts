/**
 * RTW Auto-Draft API Router
 *
 * Exposes the rtwAutoDrafter orchestrator over HTTP for the manual "Draft RTW plan"
 * button and surfaces eligibility for that button's enabled/disabled state.
 *
 * Spec: .planning/work-rtw-auto-draft.md
 *
 * Endpoints (mounted under /api/cases):
 *   POST /:caseId/auto-draft-rtw-plan      — invokes orchestrator with trigger="manual"
 *   GET  /:caseId/auto-draft-eligibility   — gate + active-draft check for UI
 */

import express, { type Response } from "express";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { requireCaseOwnership } from "../middleware/caseOwnership";
import { logger } from "../lib/logger";
import {
  draftRTWPlanForCase,
  type AutoDraftSkipReason,
} from "../services/rtwAutoDrafter";

const router = express.Router();

// Skip reasons that should map to a 4xx (caller-fixable / expected business outcome)
// vs the orchestrator throwing (which is a 5xx). All skip reasons are 4xx because
// they represent business preconditions the consultant can act on.
const SKIP_REASON_STATUS: Record<AutoDraftSkipReason, number> = {
  no_medical_constraints_gate: 400,
  existing_active_draft: 409,
  no_pre_injury_role: 400,
  worker_unfit: 400,
  confidence_below_threshold: 400,
  all_duties_not_suitable: 400,
  worker_contact_suppressed: 403,
};

/**
 * POST /api/cases/:caseId/auto-draft-rtw-plan
 * Manually trigger the auto-drafter for a single case.
 *
 * Returns 200 with `{ skipped: false, planId, versionId, planType, confidence }` on success.
 * Returns 4xx with `{ skipped: true, reason }` when a gate or fail-mode blocks drafting.
 * Returns 500 only for unexpected errors.
 */
router.post(
  "/:caseId/auto-draft-rtw-plan",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    const caseId = req.params.caseId as string;
    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;

    try {
      const result = await draftRTWPlanForCase(
        caseId,
        organizationId,
        "manual",
        userId,
        { storage },
      );

      if (result.skipped === true) {
        const status = SKIP_REASON_STATUS[result.reason] ?? 400;
        return res.status(status).json({
          skipped: true,
          reason: result.reason,
        });
      }

      return res.status(201).json({
        skipped: false,
        planId: result.planId,
        versionId: result.versionId,
        planType: result.planType,
        confidence: result.confidence,
      });
    } catch (err) {
      logger.api.error(
        "RTW auto-draft failed",
        { caseId, organizationId, userId },
        err,
      );
      return res.status(500).json({
        error: "Failed to auto-draft RTW plan",
        details: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },
);

// Statuses that mean an in-flight draft exists — block new auto-draft.
const IN_FLIGHT_STATUSES = new Set(["draft", "pending_employer_review"]);

// Statuses that mean the existing plan can be superseded — allow new auto-draft.
const SUPERSEDABLE_STATUSES = new Set(["approved", "completed"]);

/**
 * GET /api/cases/:caseId/auto-draft-eligibility
 * Lightweight check used by the UI to render the "Draft RTW plan" button
 * as enabled/disabled. Does NOT invoke the orchestrator.
 *
 * Eligibility = medical-constraints gate passes AND no in-flight draft.
 * An approved or completed plan is supersedable — eligible returns true
 * with reason "existing_plan_can_supersede" so the UI can adjust button text.
 */
router.get(
  "/:caseId/auto-draft-eligibility",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    const caseId = req.params.caseId as string;
    const organizationId = req.user!.organizationId;

    try {
      const [hasGate, latestPlan] = await Promise.all([
        storage.caseHasMedicalConstraintsGate(caseId, organizationId),
        storage.getLatestRTWPlanByCase(caseId, organizationId),
      ]);

      const latestStatus = latestPlan?.plan.status ?? null;
      const hasActiveDraft = latestStatus !== null && IN_FLIGHT_STATUSES.has(latestStatus);
      const canSupersede = latestStatus !== null && SUPERSEDABLE_STATUSES.has(latestStatus);

      let eligible = true;
      let reason: AutoDraftSkipReason | "existing_plan_can_supersede" | undefined;

      if (!hasGate) {
        eligible = false;
        reason = "no_medical_constraints_gate";
      } else if (hasActiveDraft) {
        eligible = false;
        reason = "existing_active_draft";
      } else if (canSupersede) {
        // Eligible — existing approved/completed plan will be superseded by new draft
        reason = "existing_plan_can_supersede";
      }

      return res.json({
        eligible,
        reason,
        hasActiveDraft,
      });
    } catch (err) {
      logger.api.error(
        "RTW auto-draft eligibility check failed",
        { caseId, organizationId },
        err,
      );
      return res.status(500).json({
        error: "Failed to check auto-draft eligibility",
        details: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },
);

export default router;
