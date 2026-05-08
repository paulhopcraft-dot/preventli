import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { insertWorkerSchema, preEmploymentAssessments, type PreEmploymentAssessmentDB } from "@shared/schema";
import type { WorkerHealthTimelineEvent } from "@shared/types/timeline";
import { createLogger } from "../lib/logger";
import { mergeAndSortTimelineEvents } from "./timeline-mapper";

/** Months between checks based on clearance outcome */
const RECHECK_MONTHS: Record<string, number> = {
  cleared_unconditional: 12,
  cleared_conditional: 12,
  cleared_with_restrictions: 6, // more frequent — restrictions need reviewing
  requires_review: 0,          // immediate — pending medical review
  not_cleared: 0,               // N/A — role change needed
};

function computeNextCheckDue(assessments: { status: string; clearanceLevel: string | null; updatedAt: Date | null; createdAt: Date }[]): {
  nextCheckDue: string | null;
  recheckUrgency: "overdue" | "due_soon" | "upcoming" | "pending" | "not_applicable" | null;
  lastClearanceLevel: string | null;
  lastCompletedAt: string | null;
} {
  const completed = assessments.filter(a => a.status === "completed" && a.clearanceLevel);
  if (completed.length === 0) {
    const hasPending = assessments.some(a => a.status === "in_progress" || a.status === "sent" || a.status === "created");
    return { nextCheckDue: null, recheckUrgency: hasPending ? "pending" : null, lastClearanceLevel: null, lastCompletedAt: null };
  }

  const latest = completed[0]; // already ordered desc
  const clearance = latest.clearanceLevel!;
  const months = RECHECK_MONTHS[clearance] ?? 12;
  const completedAt = latest.updatedAt ?? latest.createdAt;
  const lastCompletedAt = completedAt.toISOString();

  if (months === 0) {
    return { nextCheckDue: null, recheckUrgency: "not_applicable", lastClearanceLevel: clearance, lastCompletedAt };
  }

  const due = new Date(completedAt);
  due.setMonth(due.getMonth() + months);
  const now = new Date();
  const daysUntil = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let recheckUrgency: "overdue" | "due_soon" | "upcoming";
  if (daysUntil <= 0) recheckUrgency = "overdue";
  else if (daysUntil <= 60) recheckUrgency = "due_soon";
  else recheckUrgency = "upcoming";

  return { nextCheckDue: due.toISOString(), recheckUrgency, lastClearanceLevel: clearance, lastCompletedAt };
}

const logger = createLogger("WorkersRoutes");
const router: Router = express.Router();

/**
 * @route GET /api/workers
 * @desc List all workers for the organization
 * @access Private
 */
router.get("/", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const workerRows = await storage.listWorkers(organizationId);
    // Enrich each worker with their latest assessment summary
    const workers = await Promise.all(
      workerRows.map(async (w) => {
        const profile = await storage.getWorkerProfile(w.id);
        const assessments = profile?.assessments ?? [];
        const checkRec = computeNextCheckDue(assessments as any[]);
        const latestAssessment = assessments[0] ?? null;
        return {
          ...w,
          latestAssessmentStatus: latestAssessment?.status ?? null,
          latestClearanceLevel: latestAssessment?.clearanceLevel ?? null,
          latestPositionTitle: latestAssessment?.positionTitle ?? null,
          assessmentCount: assessments.length,
          ...checkRec,
        };
      })
    );
    res.json({ workers });
  } catch (error) {
    logger.error("Error listing workers:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve workers" });
  }
});

/**
 * @route GET /api/workers/:id
 * @desc Get worker profile with full history (assessments, bookings)
 * @access Private
 */
router.get("/:id", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;
    const profile = await storage.getWorkerProfile(id);
    if (!profile) {
      return res.status(404).json({ error: "Worker not found" });
    }
    // Tenant isolation: 404 (not 403) on cross-org access to avoid leaking existence.
    if (profile.worker.organizationId !== organizationId) {
      return res.status(404).json({ error: "Worker not found" });
    }
    const checkRec = computeNextCheckDue(profile.assessments as any[]);
    res.json({ ...profile, ...checkRec });
  } catch (error) {
    logger.error("Error getting worker profile:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve worker profile" });
  }
});

/**
 * @route GET /api/workers/:id/health-timeline
 * @desc Merged timeline of assessments, cases, and certificates for a worker
 * @access Private — tenant-isolated by organizationId
 */
router.get("/:id/health-timeline", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;

    const profile = await storage.getWorkerProfile(id);
    if (!profile) {
      return res.status(404).json({ error: "Worker not found" });
    }
    // Tenant isolation: 404 (not 403) on cross-org access to avoid leaking existence.
    if (profile.worker.organizationId !== organizationId) {
      return res.status(404).json({ error: "Worker not found" });
    }

    const workerName = profile.worker.name;
    const [assessments, cases, certificates] = await Promise.all([
      db
        .select()
        .from(preEmploymentAssessments)
        .where(eq(preEmploymentAssessments.workerId, id)) as Promise<PreEmploymentAssessmentDB[]>,
      storage.getWorkerCasesByWorker(id, workerName, organizationId),
      storage.getCertificatesForWorkerTimeline(id, workerName, organizationId),
    ]);

    const events: WorkerHealthTimelineEvent[] = mergeAndSortTimelineEvents(
      assessments,
      cases,
      certificates,
    );

    res.json({ events });
  } catch (error) {
    logger.error("Error getting worker health timeline:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve worker health timeline" });
  }
});

/**
 * @route POST /api/workers
 * @desc Create or upsert a worker (matched by email)
 * @access Private
 */
router.post("/", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const validatedData = insertWorkerSchema.parse({
      ...req.body,
      organizationId,
    });
    const worker = await storage.upsertWorkerByEmail(validatedData);
    res.status(201).json({ worker });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    logger.error("Error creating worker:", undefined, error);
    res.status(500).json({ error: "Failed to create worker" });
  }
});

export default router;
