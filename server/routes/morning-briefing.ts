/**
 * Morning Briefing — Alex's daily summary for case managers
 *
 * GET /api/morning-briefing
 * Returns the latest coordinator agent summary + overdue/pending actions.
 * Designed to power the "Good morning" modal on first daily login.
 */

import express, { type Response, type Router } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { agentJobs } from "@shared/schema";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { createLogger } from "../lib/logger";

const logger = createLogger("MorningBriefing");
const router: Router = express.Router();

/**
 * GET /api/morning-briefing
 * Returns Alex's morning briefing: coordinator summary + action cards.
 */
router.get("/", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    // Get latest completed coordinator job (within last 24 hours)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [latestJob] = await db
      .select({
        id: agentJobs.id,
        summary: agentJobs.summary,
        completedAt: agentJobs.completedAt,
        status: agentJobs.status,
      })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.organizationId, organizationId),
          eq(agentJobs.agentType, "coordinator"),
          eq(agentJobs.status, "completed"),
          gte(agentJobs.createdAt, since)
        )
      )
      .orderBy(desc(agentJobs.completedAt))
      .limit(1);

    // Get overdue actions (top 5)
    const overdueActions = await storage.getOverdueActions(organizationId, 5);

    // Get pending actions (top 5)
    const pendingActions = await storage.getPendingActions(organizationId, 5);

    const hasAgentSummary = !!latestJob?.summary;
    const hasActions = overdueActions.length > 0 || pendingActions.length > 0;

    res.json({
      success: true,
      data: {
        summary: latestJob?.summary ?? null,
        generatedAt: latestJob?.completedAt ?? null,
        overdueActions,
        pendingActions,
        hasData: hasAgentSummary || hasActions,
      },
    });
  } catch (error: any) {
    logger.error("Morning briefing fetch failed", {}, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
