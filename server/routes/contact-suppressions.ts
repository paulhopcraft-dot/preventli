import express, { type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { auditLog } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { recomputeEngagementFor } from "../services/engagementRecompute";

const router = express.Router();
const requireAuth = authorize(["admin", "employer", "clinician"]);

const reasonSchema = z.object({
  reason: z.string().min(5),
});

/**
 * POST /api/workers/:workerId/contact-suppressions
 * Create a new contact suppression (pause outreach) for a worker.
 */
router.post(
  "/workers/:workerId/contact-suppressions",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const workerId = req.params.workerId as string;
      const actor = req.user!.id;

      const parsed = reasonSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { reason } = parsed.data;

      const created = await storage.createContactSuppression({
        workerId,
        reason,
        source: "clinician",
      });

      await auditLog({
        workerId,
        eventType: "contact.suppressed",
        actor,
        payload: { reason, suppressionId: created.id },
      });

      // fire-and-forget — engagement recompute is best-effort
      recomputeEngagementFor(workerId, "contact.suppressed").catch(() => {});

      return res.status(201).json(created);
    } catch (err) {
      logger.api.error("[ContactSuppressions] POST error", {}, err);
      return res.status(500).json({ error: "Failed to create contact suppression" });
    }
  }
);

/**
 * DELETE /api/contact-suppressions/:id
 * Unpause (lift) a contact suppression. Requires a reason.
 */
router.delete(
  "/contact-suppressions/:id",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const actor = req.user!.id;

      const parsed = reasonSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { reason } = parsed.data;

      const updated = await storage.unpauseSuppression(id, actor, reason);

      await auditLog({
        workerId: updated.workerId,
        eventType: "contact.unsuppressed",
        actor,
        payload: { suppressionId: id, reason },
      });

      // fire-and-forget — engagement recompute is best-effort
      recomputeEngagementFor(updated.workerId, "contact.unsuppressed").catch(() => {});

      return res.status(200).json(updated);
    } catch (err) {
      logger.api.error("[ContactSuppressions] DELETE error", {}, err);
      return res.status(500).json({ error: "Failed to unpause contact suppression" });
    }
  }
);

/**
 * GET /api/workers/:workerId/contact-suppressions
 * List all suppressions (including unpaused) for a worker, descending by createdAt.
 */
router.get(
  "/workers/:workerId/contact-suppressions",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const workerId = req.params.workerId as string;

      const data = await storage.getAllSuppressionsForWorker(workerId);
      const activeCount = data.filter((s) => s.unpausedAt === null).length;

      return res.json({ data, activeCount });
    } catch (err) {
      logger.api.error("[ContactSuppressions] GET error", {}, err);
      return res.status(500).json({ error: "Failed to fetch contact suppressions" });
    }
  }
);

export default router;
