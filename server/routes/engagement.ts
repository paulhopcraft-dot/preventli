import { Router, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { pushEscalation, ESCALATION_THRESHOLD } from "../services/insurerStub";
import { auditLog } from "../lib/auditLog";
import { createLogger } from "../lib/logger";
import { db } from "../db";
import { workerCases } from "@shared/schema";
import { eq } from "drizzle-orm";

const log = createLogger("EngagementRoute");
const router = Router();

router.use(authorize(["admin", "employer", "clinician"]));

/**
 * GET /api/workers/:workerId/engagement-score
 * Returns the latest materialized engagement score for a worker.
 */
router.get("/workers/:workerId/engagement-score", async (req: AuthRequest, res: Response) => {
  const workerId = req.params.workerId as string;
  try {
    const row = await storage.getLatestEngagementScore(workerId);
    if (!row) {
      return res.json({
        workerId,
        score: null,
        components: {},
        noData: true,
        thresholdAtTrigger: ESCALATION_THRESHOLD,
      });
    }
    res.json({
      workerId,
      score: Number(row.score),
      components: row.components ?? {},
      triggeredBy: row.triggeredBy,
      calculatedAt: row.createdAt,
      noData: false,
      thresholdAtTrigger: ESCALATION_THRESHOLD,
      canEscalate: Number(row.score) < ESCALATION_THRESHOLD,
    });
  } catch (err) {
    log.error("Engagement score fetch failed", { workerId }, err);
    res.status(500).json({ error: "Failed to fetch engagement score" });
  }
});

/**
 * POST /api/cases/:caseId/escalate-to-insurer
 * Escalates a case to the insurer (stub) when engagement score is below threshold.
 * Requires messageBody (min 20 chars) so the clinician articulates the issue.
 */
router.post("/cases/:caseId/escalate-to-insurer", async (req: AuthRequest, res: Response) => {
  const caseId = req.params.caseId as string;
  try {
    const parsed = z.object({ messageBody: z.string().min(20) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "messageBody required (min 20 chars)" });
    }

    // Look up the case to get workerId + workerName
    const [caseRow] = await db
      .select({
        id: workerCases.id,
        workerId: workerCases.workerId,
        workerName: workerCases.workerName,
      })
      .from(workerCases)
      .where(eq(workerCases.id, caseId))
      .limit(1);

    if (!caseRow) {
      return res.status(404).json({ error: "Case not found" });
    }

    const workerId = caseRow.workerId;
    if (!workerId) {
      return res.status(400).json({ error: "Case has no linked worker — cannot escalate" });
    }

    const latestScore = await storage.getLatestEngagementScore(workerId);
    if (!latestScore) {
      return res.status(400).json({ error: "No engagement score yet — cannot escalate" });
    }

    const scoreAtTrigger = Number(latestScore.score);

    // Push to stub adapter (writes audit_events internally)
    const pushResult = await pushEscalation({
      caseId,
      workerName: caseRow.workerName ?? "Unknown",
      triggeredByUserId: req.user!.id,
      scoreAtTrigger,
      thresholdAtTrigger: ESCALATION_THRESHOLD,
      messageBody: parsed.data.messageBody,
    });

    // Persist insurer_escalations row
    const escalation = await storage.createInsurerEscalation({
      caseId,
      triggeredByUserId: req.user!.id,
      scoreAtTrigger: scoreAtTrigger.toString(),
      thresholdAtTrigger: ESCALATION_THRESHOLD.toString(),
      messageBody: parsed.data.messageBody,
    });

    // Audit-log the escalation at the route boundary too (belt-and-braces with
    // the stub adapter's internal auditLog) — keeps the route file directly
    // auditable per the funding-bundle invariant.
    await auditLog({
      caseId,
      workerId,
      eventType: "insurer.escalation-route",
      actor: req.user!.id,
      payload: {
        escalationId: escalation.id,
        scoreAtTrigger,
        threshold: ESCALATION_THRESHOLD,
      },
    });

    res.status(201).json({
      success: true,
      escalation: { id: escalation.id, createdAt: escalation.createdAt },
      stubResponse: pushResult.stubResponse,
    });
  } catch (err) {
    log.error("Escalate to insurer failed", { caseId }, err);
    res.status(500).json({ error: "Failed to escalate to insurer" });
  }
});

export default router;
