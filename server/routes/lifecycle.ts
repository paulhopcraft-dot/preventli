import express, { type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { requireCaseOwnership } from "../middleware/caseOwnership";
import { logAuditEvent, AuditEventTypes } from "../services/auditLogger";
import { LIFECYCLE_TRANSITIONS, LIFECYCLE_STAGE_LABELS, type CaseLifecycleStage } from "@shared/schema";
import { logger } from "../lib/logger";
import { auditLog } from "../lib/auditLog";

const router = express.Router();
const requireAuth = authorize();
const requireAdmin = authorize(["admin"]);

const transitionSchema = z.object({
  toStage: z.enum([
    "intake",
    "assessment",
    "active_treatment",
    "rtw_transition",
    "maintenance",
    "closed_rtw",
    "closed_medical_retirement",
    "closed_terminated",
    "closed_claim_denied",
    "closed_other",
  ] as const),
  reason: z.string().min(1).max(500).optional(),
});

/**
 * GET /api/cases/:id/lifecycle
 * Returns the lifecycle stage log for a case.
 */
router.get(
  "/:id/lifecycle",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.id as string;
      const user = req.user!;
      const workerCase = (req as any).workerCase;

      const log = await storage.getLifecycleLog(caseId, user.organizationId);

      return res.json({
        currentStage: workerCase.lifecycleStage,
        currentStageLabel: LIFECYCLE_STAGE_LABELS[workerCase.lifecycleStage as CaseLifecycleStage] ?? workerCase.lifecycleStage,
        allowedTransitions: (LIFECYCLE_TRANSITIONS[workerCase.lifecycleStage as CaseLifecycleStage] ?? []).map(s => ({
          stage: s,
          label: LIFECYCLE_STAGE_LABELS[s],
        })),
        log: log.map(entry => ({
          ...entry,
          fromStageLabel: LIFECYCLE_STAGE_LABELS[entry.fromStage as CaseLifecycleStage] ?? entry.fromStage,
          toStageLabel: LIFECYCLE_STAGE_LABELS[entry.toStage as CaseLifecycleStage] ?? entry.toStage,
        })),
      });
    } catch (err) {
      logger.api.error("[Lifecycle] GET error", {}, err);
      return res.status(500).json({ error: "Failed to fetch lifecycle log" });
    }
  }
);

/**
 * PATCH /api/cases/:id/lifecycle
 * Transition a case to a new lifecycle stage.
 * Validates the transition is allowed before applying.
 */
router.patch(
  "/:id/lifecycle",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.id as string;
      const user = req.user!;
      const workerCase = (req as any).workerCase;

      const parsed = transitionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { toStage, reason } = parsed.data;
      const fromStage = workerCase.lifecycleStage as CaseLifecycleStage;
      const allowed = LIFECYCLE_TRANSITIONS[fromStage] ?? [];

      if (!allowed.includes(toStage)) {
        return res.status(422).json({
          error: `Cannot transition from "${LIFECYCLE_STAGE_LABELS[fromStage]}" to "${LIFECYCLE_STAGE_LABELS[toStage]}"`,
          currentStage: fromStage,
          currentStageLabel: LIFECYCLE_STAGE_LABELS[fromStage],
          allowedTransitions: allowed.map(s => ({ stage: s, label: LIFECYCLE_STAGE_LABELS[s] })),
        });
      }

      await storage.updateLifecycleStage(
        caseId,
        user.organizationId,
        toStage,
        user.id,
        reason,
        false
      );

      await logAuditEvent({
        userId: user.id,
        organizationId: user.organizationId,
        eventType: AuditEventTypes.CASE_UPDATE,
        resourceType: "worker_case",
        resourceId: caseId,
        metadata: {
          action: "lifecycle_transition",
          fromStage,
          toStage,
          reason: reason ?? null,
        },
      });

      await auditLog({
        caseId,
        eventType: "case.status-changed",
        actor: user.id,
        payload: { fromStage, toStage, reason: reason ?? null },
      });

      return res.json({
        success: true,
        fromStage,
        fromStageLabel: LIFECYCLE_STAGE_LABELS[fromStage],
        toStage,
        toStageLabel: LIFECYCLE_STAGE_LABELS[toStage],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.api.error("[Lifecycle] PATCH error", {}, err);
      // Surface validation errors to the client
      if (message.startsWith("Invalid lifecycle transition") || message.startsWith("Case ")) {
        return res.status(422).json({ error: message });
      }
      return res.status(500).json({ error: "Failed to update lifecycle stage" });
    }
  }
);

/**
 * POST /api/admin/migrate-lifecycle
 * Admin-only: auto-assign lifecycle stages to cases still at the default "intake" stage.
 */
router.post(
  "/admin/migrate-lifecycle",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      const orgId = (req.query.organizationId as string) ?? user.organizationId;

      const updated = await storage.autoAssignLifecycleStages(orgId);

      logger.api.info(`[Lifecycle Migration] Updated ${updated.length} cases for org ${orgId}`);

      return res.json({
        success: true,
        updated: updated.length,
        cases: updated,
      });
    } catch (err) {
      logger.api.error("[Lifecycle Migration] Error", {}, err);
      return res.status(500).json({ error: "Migration failed" });
    }
  }
);

const assignSchema = z.object({
  caseManagerId: z.string().min(1),
  caseManagerName: z.string().min(1),
  secondaryAssigneeId: z.string().optional(),
});

/**
 * PATCH /api/cases/:id/assign
 * Assign a case manager (and optionally a secondary assignee) to a case.
 * Restricted to admin and case_manager roles.
 */
router.patch(
  "/:id/assign",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;

      if (user.role !== "admin" && user.role !== "clinician") {
        return res.status(403).json({ error: "Only admins and clinicians can assign cases" });
      }

      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { caseManagerId, caseManagerName, secondaryAssigneeId } = parsed.data;
      const caseId = req.params.id as string;

      await storage.assignCase(caseId, user.organizationId, caseManagerId, caseManagerName, secondaryAssigneeId);

      await logAuditEvent({
        userId: user.id,
        organizationId: user.organizationId,
        eventType: AuditEventTypes.CASE_UPDATE,
        resourceType: "worker_case",
        resourceId: caseId,
        metadata: { action: "case_assigned", caseManagerId, caseManagerName },
      });

      return res.json({ success: true, caseManagerId, caseManagerName });
    } catch (err) {
      logger.api.error("[Case Assign] PATCH error", {}, err);
      return res.status(500).json({ error: "Failed to assign case" });
    }
  }
);

export default router;
