import { Router } from "express";
import { authorize } from "../middleware/auth";
import { logAuditEvent, AuditEventTypes, getRequestMetadata } from "../services/auditLogger";
import { db } from "../db";
import { workerCases } from "@shared/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const router = Router();
const logger = createLogger("ExitProcessing");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExitStatus =
  | "pending_health_check"
  | "health_check_complete"
  | "pending_final_review";

interface ExitCase {
  id: string;
  employeeName: string;
  department: string;
  exitDate: string | null;
  status: ExitStatus;
  reason: string;
  finalHealthCheckRequired: boolean;
  documentsCompleted: number;
  totalDocuments: number;
}

interface ExitSummary {
  totalCases: number;
  healthChecksPending: number;
  healthChecksRequired: number;
  documentsCompleted: number;
  totalDocuments: number;
  liabilityReadyForClosure: number;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a UI-facing exit status from DB columns. */
function deriveExitStatus(
  employmentStatus: string,
  terminationProcessId: string | null | undefined
): ExitStatus {
  if (terminationProcessId) {
    // Formal WorkSafe termination process recorded → health check was completed
    return "health_check_complete";
  }
  if (employmentStatus === "TERMINATED") {
    // Terminated without formal process → awaiting final review
    return "pending_final_review";
  }
  // Closed for any other reason (returned to work, admin close, etc.)
  return "pending_health_check";
}

/** Normalise a free-text closedReason to one of the UI reason values. */
function normaliseReason(closedReason: string | null | undefined): string {
  if (!closedReason) return "other";
  const r = closedReason.toLowerCase();
  if (r.includes("resign") || r.includes("voluntary")) return "resignation";
  if (r.includes("redundan") || r.includes("retrench")) return "redundancy";
  if (r.includes("retir")) return "retirement";
  if (r.includes("terminat") || r.includes("dismissed")) return "termination";
  return closedReason; // Return raw value if no match
}

/** Derive document counts from the exit status (we have no real doc table yet). */
function deriveDocCounts(status: ExitStatus): { completed: number; total: number } {
  switch (status) {
    case "health_check_complete":
      return { completed: 5, total: 5 };
    case "pending_final_review":
      return { completed: 2, total: 3 };
    case "pending_health_check":
    default:
      return { completed: 3, total: 5 };
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/exit-processing/cases
 * Returns closed worker cases shaped as exit-processing records.
 */
router.get("/cases", authorize(), async (req, res) => {
  try {
    const { organizationId } = req.user!;

    logAuditEvent({
      organizationId,
      userId: req.user!.id,
      eventType: AuditEventTypes.CASE_VIEW,
      resourceType: "exit_processing",
      resourceId: "cases",
      metadata: getRequestMetadata(req),
    });

    const rows = await db
      .select({
        id: workerCases.id,
        workerName: workerCases.workerName,
        company: workerCases.company,
        closedAt: workerCases.closedAt,
        closedReason: workerCases.closedReason,
        employmentStatus: workerCases.employmentStatus,
        terminationProcessId: workerCases.terminationProcessId,
      })
      .from(workerCases)
      .where(
        and(
          eq(workerCases.organizationId, organizationId),
          eq(workerCases.caseStatus, "closed")
        )
      );

    const exitCases: ExitCase[] = rows.map((row) => {
      const status = deriveExitStatus(row.employmentStatus, row.terminationProcessId);
      const reason = normaliseReason(row.closedReason);
      const docCounts = deriveDocCounts(status);

      return {
        id: row.id,
        employeeName: row.workerName,
        department: row.company,
        exitDate: row.closedAt ? row.closedAt.toISOString().split("T")[0] : null,
        status,
        reason,
        finalHealthCheckRequired: status === "pending_health_check",
        documentsCompleted: docCounts.completed,
        totalDocuments: docCounts.total,
      };
    });

    logger.info(`Retrieved ${exitCases.length} exit processing cases`, {
      organizationId,
      userId: req.user!.id,
    });

    res.json({ cases: exitCases });
  } catch (error) {
    logger.error("Error fetching exit processing cases:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve exit processing cases" });
  }
});

/**
 * GET /api/exit-processing/summary
 * Aggregate statistics for the exit processing dashboard.
 */
router.get("/summary", authorize(), async (req, res) => {
  try {
    const { organizationId } = req.user!;

    const rows = await db
      .select({
        employmentStatus: workerCases.employmentStatus,
        terminationProcessId: workerCases.terminationProcessId,
      })
      .from(workerCases)
      .where(
        and(
          eq(workerCases.organizationId, organizationId),
          eq(workerCases.caseStatus, "closed")
        )
      );

    const statuses = rows.map((r) =>
      deriveExitStatus(r.employmentStatus, r.terminationProcessId)
    );

    const totalCases = statuses.length;
    const healthChecksPending = statuses.filter(
      (s) => s === "pending_health_check"
    ).length;
    const healthChecksRequired = statuses.filter(
      (s) => s === "pending_health_check" || s === "health_check_complete"
    ).length;
    const liabilityReadyForClosure = statuses.filter(
      (s) => s === "pending_final_review"
    ).length;

    // Derive doc stats from the per-case counts
    let totalDocumentsCompleted = 0;
    let totalDocumentsTotal = 0;
    for (const s of statuses) {
      const { completed, total } = deriveDocCounts(s);
      totalDocumentsCompleted += completed;
      totalDocumentsTotal += total;
    }

    const summary: ExitSummary = {
      totalCases,
      healthChecksPending,
      healthChecksRequired,
      documentsCompleted: totalDocumentsCompleted,
      totalDocuments: totalDocumentsTotal,
      liabilityReadyForClosure,
      lastUpdated: new Date().toISOString(),
    };

    res.json({ summary });
  } catch (error) {
    logger.error("Error fetching exit processing summary:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve exit processing summary" });
  }
});

export default router;
