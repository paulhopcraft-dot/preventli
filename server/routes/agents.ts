/**
 * Agents API Route
 *
 * Endpoints:
 *   POST /api/agents/trigger         — manually trigger an agent job
 *   GET  /api/agents/jobs            — list agent jobs (with filter)
 *   GET  /api/agents/jobs/:jobId     — get a single job + its action log
 *   GET  /api/agents/status          — scheduler health check
 *   POST /api/agents/briefing        — manually trigger morning briefing (admin)
 *   POST /api/agents/jobs/:jobId/approve-action — approve a pending action (human-in-loop)
 *   POST /api/agents/jobs/:jobId/reject-action  — reject a pending action
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { agentJobs, agentActions, users } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { authorize, type AuthRequest } from "../middleware/auth";
import { agentScheduler } from "../agent-runner/triggers";
import { runSpecialistAgent } from "../agents/agent-runner";
import { createLogger } from "../lib/logger";
import { logAuditEvent, AuditEventTypes } from "../services/auditLogger";

const router = Router();
const logger = createLogger("AgentsRoute");

// ─── Trigger a manual agent job ────────────────────────────────────────────

const triggerSchema = z.object({
  agentType: z.enum(["coordinator", "rtw", "recovery", "certificate"]),
  caseId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

router.post("/trigger", authorize(), async (req: AuthRequest, res) => {
  const parsed = triggerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
  }

  const { agentType, caseId, context } = parsed.data;
  const organizationId = req.user!.organizationId;

  try {
    const [job] = await db
      .insert(agentJobs)
      .values({
        organizationId,
        caseId: caseId || null,
        agentType,
        status: "queued",
        triggeredBy: "manual",
        triggeredByUserId: req.user!.id,
        context: context || {},
      } as any)
      .returning();

    // Run async
    setImmediate(() =>
      runSpecialistAgent(job.id).catch((err) => {
        logger.error("Manual agent job failed", { jobId: job.id }, err);
      })
    );

    res.status(202).json({
      jobId: job.id,
      agentType,
      status: "queued",
      message: "Agent job queued — check /api/agents/jobs/:jobId for progress",
    });
  } catch (err) {
    logger.error("Failed to trigger agent", {}, err);
    res.status(500).json({ error: "Failed to trigger agent" });
  }
});

// ─── List jobs ──────────────────────────────────────────────────────────────

router.get("/jobs", authorize(), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.role === "admin" ? undefined : req.user!.organizationId;
    const caseId = req.query.caseId as string | undefined;
    const agentType = req.query.agentType as string | undefined;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    const conditions = [];
    if (organizationId) conditions.push(eq(agentJobs.organizationId, organizationId));
    if (caseId) conditions.push(eq(agentJobs.caseId, caseId));
    if (agentType) conditions.push(eq(agentJobs.agentType, agentType as any));

    const jobs = await db
      .select()
      .from(agentJobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agentJobs.createdAt))
      .limit(limit);

    res.json({ jobs, total: jobs.length });
  } catch (err) {
    logger.error("Failed to list agent jobs", {}, err);
    res.status(500).json({ error: "Failed to list agent jobs" });
  }
});

// ─── Get single job + action log ────────────────────────────────────────────

router.get("/jobs/:jobId", authorize(), async (req: AuthRequest, res) => {
  try {
    const jobId = req.params.jobId as string;

    const [job] = await db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.id, jobId))
      .limit(1);

    if (!job) return res.status(404).json({ error: "Job not found" });

    // Check org access (unless admin)
    if (req.user!.role !== "admin" && job.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const actions = await db
      .select()
      .from(agentActions)
      .where(eq(agentActions.jobId, jobId))
      .orderBy(agentActions.executedAt);

    res.json({ job, actions });
  } catch (err) {
    logger.error("Failed to get agent job", { jobId: req.params.jobId }, err);
    res.status(500).json({ error: "Failed to get agent job" });
  }
});

// ─── Scheduler status ───────────────────────────────────────────────────────

router.get("/status", authorize(["admin"]), (_req, res) => {
  res.json({
    scheduler: agentScheduler.getStatus(),
    enabled: process.env.AGENTS_ENABLED === "true",
  });
});

// ─── Manual morning briefing (admin) ────────────────────────────────────────

router.post("/briefing", authorize(["admin"]), async (_req, res) => {
  try {
    const result = await agentScheduler.triggerMorningBriefing();
    res.json({ ...result, message: "Morning briefing triggered" });
  } catch (err) {
    logger.error("Failed to trigger morning briefing", {}, err);
    res.status(500).json({ error: "Failed to trigger morning briefing" });
  }
});

// ─── Approve a pending action (human-in-loop Tier 2) ───────────────────────

const approvalSchema = z.object({
  actionId: z.string(),
});

router.post("/jobs/:jobId/approve-action", authorize(), async (req: AuthRequest, res) => {
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
  }

  try {
    await db
      .update(agentActions)
      .set({
        approvalStatus: "approved",
        approvedBy: req.user!.id,
        approvedAt: new Date(),
      } as any)
      .where(eq(agentActions.id, parsed.data.actionId));

    logAuditEvent({ eventType: AuditEventTypes.ACTION_UPDATE, userId: req.user?.id ?? null, organizationId: req.user?.organizationId ?? null, resourceType: 'agent_action', resourceId: parsed.data.actionId, metadata: { approval: 'approved', jobId: req.params.jobId } });
    res.json({ approved: true, actionId: parsed.data.actionId });
  } catch (err) {
    logger.error("Failed to approve action", {}, err);
    res.status(500).json({ error: "Failed to approve action" });
  }
});

router.post("/jobs/:jobId/reject-action", authorize(), async (req: AuthRequest, res) => {
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
  }

  try {
    await db
      .update(agentActions)
      .set({
        approvalStatus: "rejected",
        approvedBy: req.user!.id,
        approvedAt: new Date(),
      } as any)
      .where(eq(agentActions.id, parsed.data.actionId));

    logAuditEvent({ eventType: AuditEventTypes.ACTION_UPDATE, userId: req.user?.id ?? null, organizationId: req.user?.organizationId ?? null, resourceType: 'agent_action', resourceId: parsed.data.actionId, metadata: { approval: 'rejected', jobId: req.params.jobId } });
    res.json({ rejected: true, actionId: parsed.data.actionId });
  } catch (err) {
    logger.error("Failed to reject action", {}, err);
    res.status(500).json({ error: "Failed to reject action" });
  }
});

// ─── Latest morning briefing for the current user's org ───────────────────────
// Returns the most-recent completed coordinator agent job summary for the
// authenticated user's active organization. Used by the employer dashboard
// to render the "Good morning {firstName}, ..." card.

const FIRST_NAME_OVERRIDES: Record<string, string> = {
  "wallara@wallara.com.au": "Ellen",
};

function deriveFirstName(email: string): string {
  const override = FIRST_NAME_OVERRIDES[email.toLowerCase()];
  if (override) return override;
  const prefix = (email.split("@")[0] || "").split(/[.\-_+]/)[0] || "";
  if (!prefix) return "there";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
}

router.get("/latest-briefing", authorize(), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;

    const [job] = await db
      .select({
        summary: agentJobs.summary,
        completedAt: agentJobs.completedAt,
      })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.organizationId, organizationId),
          eq(agentJobs.agentType, "coordinator"),
          eq(agentJobs.status, "completed")
        )
      )
      .orderBy(desc(agentJobs.completedAt))
      .limit(1);

    // Look up email for firstName derivation (User type has no name fields).
    const [u] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);
    const firstName = u ? deriveFirstName(u.email) : "there";

    if (!job || !job.summary) {
      return res.json({ summary: null, completedAt: null, firstName });
    }

    res.json({
      summary: job.summary,
      completedAt: job.completedAt,
      firstName,
    });
  } catch (err) {
    logger.error("Failed to fetch latest briefing", {}, err);
    res.status(500).json({ error: "Failed to fetch latest briefing" });
  }
});

export default router;
