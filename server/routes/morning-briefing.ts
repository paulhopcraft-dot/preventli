/**
 * Morning Briefing — Alex's daily summary for case managers.
 *
 * GET /api/morning-briefing
 * Returns the personalised greeting name, an optional narrative summary
 * (latest coordinator agent job within 24h, if any), and a list of
 * data-driven alerts composed from real case state — GP escalation,
 * low-compliance cases, cert-review queue.
 *
 * Replaces the previous case_actions-sourced overdue/pending arrays which
 * were empty for tenants without manually-curated actions (see session 141
 * project_alex_agent_scope notes).
 */

import express, { type Response, type Router } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { agentJobs, users } from "@shared/schema";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { createLogger } from "../lib/logger";
import { composeBriefingAlerts } from "../services/briefingAlerts";
import { deriveFirstName } from "./agents";

const logger = createLogger("MorningBriefing");
const router: Router = express.Router();

router.get("/", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    // 1. Latest coordinator agent narrative summary (within 24h, optional).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [latestJob] = await db
      .select({
        summary: agentJobs.summary,
        completedAt: agentJobs.completedAt,
      })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.organizationId, organizationId),
          eq(agentJobs.agentType, "coordinator"),
          eq(agentJobs.status, "completed"),
          gte(agentJobs.createdAt, since),
        ),
      )
      .orderBy(desc(agentJobs.completedAt))
      .limit(1);

    // 2. Compose data-driven alerts from real case state.
    const cases = await storage.getCases(organizationId);
    const alerts = composeBriefingAlerts(cases, 5);

    // 3. Personalised greeting name (preferredName → email derivation → "there").
    const [u] = await db
      .select({ email: users.email, preferredName: users.preferredName })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);
    const firstName = u ? deriveFirstName(u.email, u.preferredName) : "there";

    const hasAgentSummary = !!latestJob?.summary;
    const hasAlerts = alerts.length > 0;

    res.json({
      success: true,
      data: {
        firstName,
        summary: latestJob?.summary ?? null,
        generatedAt: latestJob?.completedAt ?? null,
        alerts,
        hasData: hasAgentSummary || hasAlerts,
      },
    });
  } catch (error: any) {
    logger.error("Morning briefing fetch failed", {}, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
