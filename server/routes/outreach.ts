/**
 * @route /api/outreach
 * Worker outreach cadence management — templates and history.
 */

import express, { type Response, type Router } from "express";
import { authorize, type AuthRequest } from "../middleware/auth";
import { agentScheduler } from "../agent-runner/triggers";
import {
  getEffectiveTemplate,
  upsertOutreachTemplate,
  getCaseOutreachLog,
} from "../services/workerOutreachService";
import type { OutreachTrigger } from "@shared/schema";

const router: Router = express.Router();

const VALID_TRIGGERS: OutreachTrigger[] = [
  "cert_expiring_7d",
  "cert_expired",
  "manager_no_response",
  "cert_downgraded",
];

/**
 * @route GET /api/outreach/templates
 * List all effective templates for this org (custom override or default).
 */
router.get("/templates", authorize(), async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  try {
    const templates = await Promise.all(
      VALID_TRIGGERS.map((trigger) => getEffectiveTemplate(orgId, trigger))
    );
    res.json({ data: templates });
  } catch (err) {
    res.status(500).json({ error: "Failed to load templates" });
  }
});

/**
 * @route GET /api/outreach/templates/:trigger
 * Get a single template (custom or default).
 */
router.get("/templates/:trigger", authorize(), async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const trigger = req.params.trigger as OutreachTrigger;
  if (!VALID_TRIGGERS.includes(trigger)) {
    return res.status(400).json({ error: "Invalid trigger", valid: VALID_TRIGGERS });
  }
  try {
    const template = await getEffectiveTemplate(orgId, trigger);
    res.json({ data: template });
  } catch {
    res.status(500).json({ error: "Failed to load template" });
  }
});

/**
 * @route PUT /api/outreach/templates/:trigger
 * Save or update a custom template for this org.
 * Body: { subject: string, body: string }
 */
router.put("/templates/:trigger", authorize(), async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const trigger = req.params.trigger as OutreachTrigger;

  if (!VALID_TRIGGERS.includes(trigger)) {
    return res.status(400).json({ error: "Invalid trigger", valid: VALID_TRIGGERS });
  }

  const { subject, body } = req.body as { subject?: string; body?: string };
  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    return res.status(400).json({ error: "subject is required" });
  }
  if (!body || typeof body !== "string" || body.trim().length === 0) {
    return res.status(400).json({ error: "body is required" });
  }

  try {
    await upsertOutreachTemplate(orgId, trigger, subject.trim(), body.trim());
    const updated = await getEffectiveTemplate(orgId, trigger);
    res.json({ data: updated });
  } catch {
    res.status(500).json({ error: "Failed to save template" });
  }
});

/**
 * @route GET /api/outreach/cases/:caseId/log
 * Outreach history for a specific case.
 */
router.get("/cases/:caseId/log", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const log = await getCaseOutreachLog(req.params.caseId);
    res.json({ data: log });
  } catch {
    res.status(500).json({ error: "Failed to load outreach log" });
  }
});

/**
 * @route POST /api/outreach/trigger
 * Manually trigger the outreach cadence (admin only — for testing).
 */
router.post("/trigger", authorize(["admin"]), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await agentScheduler.triggerWorkerOutreach();
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: "Failed to trigger outreach", detail: String(err) });
  }
});

export default router;
