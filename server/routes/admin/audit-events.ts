import { Router, type Response } from "express";
import { storage } from "../../storage";
import { authorize, type AuthRequest } from "../../middleware/auth";
import { z } from "zod";
import { createLogger } from "../../lib/logger";

const log = createLogger("AdminAuditEventsRoute");
const router = Router();
router.use(authorize(["admin"]));

const querySchema = z.object({
  caseId: z.string().optional(),
  workerId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * GET /api/admin/audit-events?caseId=...&workerId=...&limit=...
 * Returns audit_events rows scoped to a case or worker.
 * At least one of caseId or workerId must be provided.
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.errors });
  }
  const { caseId, workerId, limit = 100 } = parsed.data;
  if (!caseId && !workerId) {
    return res.status(400).json({ error: "Must supply caseId or workerId" });
  }
  try {
    const rows = caseId
      ? await storage.getAuditEventsByCase(caseId, limit)
      : await storage.getAuditEventsByWorker(workerId!, limit);
    res.json({ data: rows, count: rows.length });
  } catch (err) {
    log.error("Failed to fetch audit events", { caseId, workerId }, err);
    res.status(500).json({ error: "Failed to fetch audit events" });
  }
});

export default router;
