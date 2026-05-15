/**
 * Smart Summary Engine v1 - API Routes
 *
 * GET /api/cases/:caseId/smart-summary
 * Returns a structured case summary with risks, actions, RTW readiness, and compliance status.
 */

import express, { type Request, type Response } from "express";
import { authorize, type AuthRequest } from "../middleware/auth";
import { requireCaseOwnership } from "../middleware/caseOwnership";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { generateSmartSummary, generateFallbackSummary } from "../services/smartSummary";
import { logAuditEvent, AuditEventTypes } from "../services/auditLogger";

const router = express.Router();

/**
 * GET /api/cases/:caseId/smart-summary
 * Generate or retrieve a structured case summary
 *
 * Query params:
 * - fallback=true: Use rule-based analysis instead of AI (faster, no API key needed)
 */
router.get(
  "/:caseId/smart-summary",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware
      const useFallback = req.query.fallback === "true";

      let summary;

      if (useFallback) {
        // Use rule-based analysis (no AI)
        summary = await generateFallbackSummary(storage, workerCase.id, workerCase.organizationId);
      } else {
        // Try AI-powered analysis, fall back to rule-based if AI unavailable
        try {
          summary = await generateSmartSummary(storage, workerCase.id, workerCase.organizationId);
        } catch (error: any) {
          const msg = error.message || "";
          const isAIUnavailable =
            msg.includes("timed out") ||
            msg.includes("Claude CLI") ||
            msg.includes("ENOENT") ||
            msg.startsWith("401");
          if (isAIUnavailable) {
            logger.ai.warn("AI unavailable, using fallback summary", { errorPreview: msg.slice(0, 100) });
            summary = await generateFallbackSummary(storage, workerCase.id, workerCase.organizationId);
          } else {
            throw error;
          }
        }
      }

      logAuditEvent({ eventType: AuditEventTypes.AI_SUMMARY_GENERATE, userId: req.user?.id ?? null, organizationId: req.user?.organizationId ?? null, resourceType: 'case', resourceId: req.params.caseId as string, metadata: { triggered: 'manual', fallback: useFallback } });

      res.json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      logger.ai.error("Smart summary generation failed", {}, error);

      res.status(500).json({
        success: false,
        error: "Failed to generate summary",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/cases/:caseId/smart-summary
 * Force regenerate a structured case summary (ignores any cache)
 */
router.post(
  "/:caseId/smart-summary",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware
      const useFallback = req.query.fallback === "true";

      let summary;

      if (useFallback) {
        summary = await generateFallbackSummary(storage, workerCase.id, workerCase.organizationId);
      } else {
        try {
          summary = await generateSmartSummary(storage, workerCase.id, workerCase.organizationId);
        } catch (error: any) {
          const msg = error.message || "";
          const isAIUnavailable =
            msg.includes("timed out") ||
            msg.includes("Claude CLI") ||
            msg.includes("ENOENT") ||
            msg.startsWith("401");
          if (isAIUnavailable) {
            logger.ai.warn("AI unavailable, using fallback summary", { errorPreview: msg.slice(0, 100) });
            summary = await generateFallbackSummary(storage, workerCase.id, workerCase.organizationId);
          } else {
            throw error;
          }
        }
      }

      logAuditEvent({ eventType: AuditEventTypes.AI_SUMMARY_GENERATE, userId: req.user?.id ?? null, organizationId: req.user?.organizationId ?? null, resourceType: 'case', resourceId: req.params.caseId as string, metadata: { triggered: 'manual', regenerated: true, fallback: useFallback } });

      res.json({
        success: true,
        data: summary,
        regenerated: true,
      });
    } catch (error: any) {
      logger.ai.error("Smart summary regeneration failed", {}, error);

      res.status(500).json({
        success: false,
        error: "Failed to regenerate summary",
        message: error.message,
      });
    }
  }
);

export default router;
