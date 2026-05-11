/**
 * Treatment Plan API Routes
 *
 * POST /api/cases/:id/treatment-plan/generate - Generate new treatment plan
 * GET /api/cases/:id/treatment-plan - Get current treatment plan
 * PUT /api/cases/:id/treatment-plan/:planId - Update treatment plan
 * GET /api/cases/:id/treatment-plan/history - Get treatment plan history
 *
 * PRD-9 Compliant: Advisory only, case ownership required
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { GenerateTreatmentPlanRequest, UpdateTreatmentPlanRequest } from "../services/treatmentPlanService";
import { generateTreatmentPlan, getTreatmentPlan, updateTreatmentPlan } from "../services/treatmentPlanService";
import type { IStorage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { requireCaseOwnership } from "../middleware/caseOwnership";
import { csrfProtection, aiRateLimiter } from "../middleware/security";
import { logger } from "../lib/logger";
import { isEmployerRole } from "../lib/rbac";

// Input validation schemas
const GeneratePlanSchema = z.object({
  additionalContext: z.string().max(10000).optional(),
});

const UpdatePlanSchema = z.object({
  status: z.enum(["active", "completed", "archived"]).optional(),
  notes: z.string().max(5000).optional(),
}).refine(
  (data) => data.status !== undefined || data.notes !== undefined,
  { message: "At least one field (status or notes) must be provided" }
);

export function registerTreatmentPlanRoutes(app: Express, storage: IStorage) {
  /**
   * POST /api/cases/:id/treatment-plan/generate
   * Generate new treatment plan with AI
   * Rate limited: 3 requests per hour per IP (expensive Claude API calls)
   */
  app.post(
    "/api/cases/:id/treatment-plan/generate",
    aiRateLimiter,
    csrfProtection,
    authorize(),
    requireCaseOwnership(),
    async (req: AuthRequest, res: Response) => {
      try {
        const caseId = req.params.id as string;
        const organizationId = (req.user as any)?.organizationId;

        if (!organizationId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        // Treatment plan clinical content is not accessible to employer accounts
        if (isEmployerRole(req.user!.role)) {
          return res.status(403).json({ error: "Forbidden", message: "Treatment plan generation is not accessible to employer accounts" });
        }

        // Validate input
        const validation = GeneratePlanSchema.safeParse(req.body);
        if (!validation.success) {
          return res.status(400).json({
            error: "Invalid request body",
            details: validation.error.errors[0].message,
          });
        }

        const request: GenerateTreatmentPlanRequest = {
          caseId,
          organizationId,
          additionalContext: validation.data.additionalContext || "",
        };

        const plan = await generateTreatmentPlan(storage, request);
        return res.json(plan);
      } catch (error) {
        logger.ai.error("Error generating treatment plan", {}, error);
        return res.status(500).json({
          error: "Failed to generate treatment plan",
        });
      }
    }
  );

  /**
   * GET /api/cases/:id/treatment-plan
   * Get current treatment plan
   */
  app.get(
    "/api/cases/:id/treatment-plan",
    authorize(),
    requireCaseOwnership(),
    async (req: AuthRequest, res: Response) => {
      try {
        const caseId = req.params.id as string;
        const organizationId = (req.user as any)?.organizationId;

        if (!organizationId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        // Treatment plan clinical content is not accessible to employer accounts
        if (isEmployerRole(req.user!.role)) {
          return res.status(403).json({ error: "Forbidden", message: "Treatment plan is not accessible to employer accounts" });
        }

        const plan = await getTreatmentPlan(storage, caseId, organizationId);
        if (!plan) {
          return res.status(404).json({ error: "No treatment plan found" });
        }

        return res.json(plan);
      } catch (error) {
        logger.ai.error("Error fetching treatment plan", {}, error);
        return res.status(500).json({
          error: "Failed to fetch treatment plan",
        });
      }
    }
  );

  /**
   * PUT /api/cases/:id/treatment-plan/:planId
   * Update treatment plan status or notes
   */
  app.put(
    "/api/cases/:id/treatment-plan/:planId",
    csrfProtection,
    authorize(),
    requireCaseOwnership(),
    async (req: Request, res: Response) => {
      try {
        const caseId = req.params.id as string;
        const planId = req.params.planId as string;
        const organizationId = (req.user as any)?.organizationId;

        if (!organizationId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        // Validate input
        const validation = UpdatePlanSchema.safeParse(req.body);
        if (!validation.success) {
          return res.status(400).json({
            error: "Invalid request body",
            details: validation.error.errors[0].message,
          });
        }

        const plan = await updateTreatmentPlan(storage, caseId, organizationId, planId, validation.data);
        return res.json(plan);
      } catch (error) {
        logger.ai.error("Error updating treatment plan", {}, error);
        return res.status(500).json({
          error: "Failed to update treatment plan",
        });
      }
    }
  );

  /**
   * GET /api/cases/:id/treatment-plan/history
   * Get treatment plan history
   */
  app.get(
    "/api/cases/:id/treatment-plan/history",
    authorize(),
    requireCaseOwnership(),
    async (req: Request, res: Response) => {
      try {
        const caseId = req.params.id as string;
        const organizationId = (req.user as any)?.organizationId;

        if (!organizationId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const workerCase = await storage.getGPNet2CaseById(caseId, organizationId);
        if (!workerCase) {
          return res.status(404).json({ error: "Case not found" });
        }

        const history = workerCase.clinical_status_json?.treatmentPlanHistory || [];
        return res.json(history);
      } catch (error) {
        logger.ai.error("Error fetching treatment plan history", {}, error);
        return res.status(500).json({
          error: "Failed to fetch treatment plan history",
        });
      }
    }
  );
}
