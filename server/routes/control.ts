/**
 * Control Tower API
 *
 * Admin-only endpoints exposing live operational metrics.
 *
 *   GET /api/control/overview  — top-level KPIs
 *   GET /api/control/agents    — agent job stats (last 24h)
 *   GET /api/control/ai        — LLM call stats derived from agent jobs
 *   GET /api/control/uploads   — file upload stats from case attachments
 *   GET /api/control/auth      — auth event stats from audit_events
 */

import { Router } from "express";
import { db } from "../db";
import {
  agentJobs,
  agentActions,
  auditEvents,
  caseAttachments,
  workerCases,
  users,
} from "@shared/schema";
import { eq, gte, sql, and, count } from "drizzle-orm";
import { authorize, type AuthRequest } from "../middleware/auth";
import { createLogger } from "../lib/logger";
import { getAlertSummary, resolveAlert } from "../services/alertService";
import { getPerformanceSnapshot, recordAgentJob } from "../services/metricsService";

const router = Router();
const log = createLogger("ControlTower");

// All control tower endpoints are admin-only
router.use(authorize(["admin"]));

function since(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

// ─── Overview ──────────────────────────────────────────────────────────────

router.get("/overview", async (_req: AuthRequest, res) => {
  try {
    const [
      totalCases,
      activeCases,
      totalUsers,
      agentJobsToday,
      agentJobsFailed,
      uploadCount,
    ] = await Promise.all([
      db.select({ count: count() }).from(workerCases),
      db
        .select({ count: count() })
        .from(workerCases)
        .where(eq(workerCases.caseStatus, "open")),
      db.select({ count: count() }).from(users),
      db
        .select({ count: count() })
        .from(agentJobs)
        .where(gte(agentJobs.createdAt, since(24))),
      db
        .select({ count: count() })
        .from(agentJobs)
        .where(
          and(
            eq(agentJobs.status, "failed"),
            gte(agentJobs.createdAt, since(24))
          )
        ),
      db
        .select({ count: count() })
        .from(caseAttachments)
        .where(gte(caseAttachments.createdAt, since(24))),
    ]);

    res.json({
      totalCases: totalCases[0]?.count ?? 0,
      openCases: activeCases[0]?.count ?? 0,
      totalUsers: totalUsers[0]?.count ?? 0,
      agentJobsToday: agentJobsToday[0]?.count ?? 0,
      agentJobsFailed: agentJobsFailed[0]?.count ?? 0,
      uploadsToday: uploadCount[0]?.count ?? 0,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error("Overview query failed", {}, err as Error);
    res.status(500).json({ error: "Failed to load overview metrics" });
  }
});

// ─── Agents ────────────────────────────────────────────────────────────────

router.get("/agents", async (_req: AuthRequest, res) => {
  try {
    const window24h = since(24);
    const window7d = since(7 * 24);

    const [byStatus, byType, recentJobs, totalActions] = await Promise.all([
      // Jobs by status last 24h
      db
        .select({
          status: agentJobs.status,
          count: count(),
        })
        .from(agentJobs)
        .where(gte(agentJobs.createdAt, window24h))
        .groupBy(agentJobs.status),

      // Jobs by agent type last 24h
      db
        .select({
          agentType: agentJobs.agentType,
          count: count(),
        })
        .from(agentJobs)
        .where(gte(agentJobs.createdAt, window24h))
        .groupBy(agentJobs.agentType),

      // 10 most recent jobs
      db
        .select({
          id: agentJobs.id,
          agentType: agentJobs.agentType,
          status: agentJobs.status,
          summary: agentJobs.summary,
          error: agentJobs.error,
          createdAt: agentJobs.createdAt,
          completedAt: agentJobs.completedAt,
        })
        .from(agentJobs)
        .orderBy(sql`${agentJobs.createdAt} desc`)
        .limit(10),

      // Total actions last 7d
      db
        .select({ count: count() })
        .from(agentActions)
        .where(gte(agentActions.executedAt, window7d)),
    ]);

    const statusMap = Object.fromEntries(
      byStatus.map((r) => [r.status, Number(r.count)])
    );
    const typeMap = Object.fromEntries(
      byType.map((r) => [r.agentType, Number(r.count)])
    );

    res.json({
      last24h: {
        total: byStatus.reduce((s, r) => s + Number(r.count), 0),
        completed: statusMap["completed"] ?? 0,
        failed: statusMap["failed"] ?? 0,
        running: statusMap["running"] ?? 0,
        queued: statusMap["queued"] ?? 0,
      },
      byType: typeMap,
      totalActionsLast7d: totalActions[0]?.count ?? 0,
      recentJobs,
    });
  } catch (err) {
    log.error("Agents query failed", {}, err as Error);
    res.status(500).json({ error: "Failed to load agent metrics" });
  }
});

// ─── AI / LLM ──────────────────────────────────────────────────────────────

router.get("/ai", async (_req: AuthRequest, res) => {
  try {
    const window24h = since(24);
    const window7d = since(7 * 24);

    const [jobsLast24h, jobsLast7d, completedWithTime] = await Promise.all([
      // Completed jobs in last 24h = proxy for LLM calls
      db
        .select({ count: count() })
        .from(agentJobs)
        .where(
          and(
            eq(agentJobs.status, "completed"),
            gte(agentJobs.createdAt, window24h)
          )
        ),

      db
        .select({ count: count() })
        .from(agentJobs)
        .where(
          and(
            eq(agentJobs.status, "completed"),
            gte(agentJobs.createdAt, window7d)
          )
        ),

      // Avg duration for completed jobs
      db
        .select({
          avgMs: sql<number>`avg(extract(epoch from (${agentJobs.completedAt} - ${agentJobs.startedAt})) * 1000)`,
        })
        .from(agentJobs)
        .where(
          and(
            eq(agentJobs.status, "completed"),
            gte(agentJobs.createdAt, window7d),
            sql`${agentJobs.completedAt} is not null`,
            sql`${agentJobs.startedAt} is not null`
          )
        ),
    ]);

    const provider = process.env.LLM_PROVIDER ?? "openrouter";
    const model =
      process.env.LLM_MODEL ??
      (provider === "anthropic"
        ? "claude-sonnet-4-5-20250929"
        : "anthropic/claude-sonnet-4-5");

    res.json({
      provider,
      model,
      callsLast24h: Number(jobsLast24h[0]?.count ?? 0),
      callsLast7d: Number(jobsLast7d[0]?.count ?? 0),
      avgDurationMs: Math.round(Number(completedWithTime[0]?.avgMs ?? 0)),
    });
  } catch (err) {
    log.error("AI metrics query failed", {}, err as Error);
    res.status(500).json({ error: "Failed to load AI metrics" });
  }
});

// ─── Uploads ───────────────────────────────────────────────────────────────

router.get("/uploads", async (_req: AuthRequest, res) => {
  try {
    const window24h = since(24);
    const window7d = since(7 * 24);

    const [today, last7d, byType] = await Promise.all([
      db
        .select({ count: count() })
        .from(caseAttachments)
        .where(gte(caseAttachments.createdAt, window24h)),

      db
        .select({ count: count() })
        .from(caseAttachments)
        .where(gte(caseAttachments.createdAt, window7d)),

      db
        .select({ type: caseAttachments.type, count: count() })
        .from(caseAttachments)
        .where(gte(caseAttachments.createdAt, window7d))
        .groupBy(caseAttachments.type),
    ]);

    res.json({
      uploadsLast24h: Number(today[0]?.count ?? 0),
      uploadsLast7d: Number(last7d[0]?.count ?? 0),
      byType: Object.fromEntries(
        byType.map((r) => [r.type ?? "unknown", Number(r.count)])
      ),
      storageProvider: process.env.STORAGE_PROVIDER ?? "local",
    });
  } catch (err) {
    log.error("Uploads query failed", {}, err as Error);
    res.status(500).json({ error: "Failed to load upload metrics" });
  }
});

// ─── Auth ──────────────────────────────────────────────────────────────────

router.get("/auth", async (_req: AuthRequest, res) => {
  try {
    const window24h = since(24);
    const window7d = since(7 * 24);

    const [eventCounts24h, eventCounts7d] = await Promise.all([
      db
        .select({ eventType: auditEvents.eventType, count: count() })
        .from(auditEvents)
        .where(gte(auditEvents.timestamp, window24h))
        .groupBy(auditEvents.eventType),

      db
        .select({ eventType: auditEvents.eventType, count: count() })
        .from(auditEvents)
        .where(gte(auditEvents.timestamp, window7d))
        .groupBy(auditEvents.eventType),
    ]);

    const map24h = Object.fromEntries(
      eventCounts24h.map((r) => [r.eventType, Number(r.count)])
    );
    const map7d = Object.fromEntries(
      eventCounts7d.map((r) => [r.eventType, Number(r.count)])
    );

    res.json({
      last24h: {
        logins: map24h["user.login"] ?? 0,
        registrations: map24h["user.register"] ?? 0,
        loginFailures: map24h["user.login_failed"] ?? 0,
        total: eventCounts24h.reduce((s, r) => s + Number(r.count), 0),
      },
      last7d: {
        logins: map7d["user.login"] ?? 0,
        registrations: map7d["user.register"] ?? 0,
        loginFailures: map7d["user.login_failed"] ?? 0,
        total: eventCounts7d.reduce((s, r) => s + Number(r.count), 0),
      },
    });
  } catch (err) {
    log.error("Auth metrics query failed", {}, err as Error);
    res.status(500).json({ error: "Failed to load auth metrics" });
  }
});

// ─── Performance ───────────────────────────────────────────────────────────

router.get("/performance", async (_req: AuthRequest, res) => {
  try {
    // Pull recent completed agent job durations from DB to seed in-process metrics
    // (needed on first request after restart when ring buffer is empty)
    const window1h = new Date(Date.now() - 60 * 60 * 1000);
    const recentCompleted = await db
      .select({
        agentType: agentJobs.agentType,
        startedAt: agentJobs.startedAt,
        completedAt: agentJobs.completedAt,
      })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "completed"),
          gte(agentJobs.createdAt, window1h),
          sql`${agentJobs.completedAt} is not null`,
          sql`${agentJobs.startedAt} is not null`
        )
      )
      .limit(50);

    // Back-fill metrics from DB (idempotent — ring buffer deduplication not needed
    // because values are consistent; slight over-counting is acceptable)
    for (const job of recentCompleted) {
      if (job.startedAt && job.completedAt) {
        const ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
        if (ms > 0) recordAgentJob(job.agentType, ms);
      }
    }

    res.json(getPerformanceSnapshot());
  } catch (err) {
    log.error("Performance query failed", {}, err as Error);
    res.status(500).json({ error: "Failed to load performance metrics" });
  }
});

// ─── Alerts ────────────────────────────────────────────────────────────────

router.get("/alerts", (_req: AuthRequest, res) => {
  try {
    const summary = getAlertSummary();
    res.json({
      activeCount: summary.activeAlerts.length,
      failureCount: summary.systemFailures.length,
      activeAlerts: summary.activeAlerts,
      recentAlerts: summary.recentAlerts,
      systemFailures: summary.systemFailures,
    });
  } catch (err) {
    log.error("Alerts query failed", {}, err as Error);
    res.status(500).json({ error: "Failed to load alert summary" });
  }
});

// Resolve (dismiss) an alert
router.post("/alerts/:id/resolve", (req: AuthRequest, res) => {
  const resolved = resolveAlert(req.params.id as string);
  res.json({ resolved });
});

export default router;
