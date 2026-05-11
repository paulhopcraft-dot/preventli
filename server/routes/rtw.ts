import { Router, type Response } from "express";
import { z } from "zod";
import { authorize, type AuthRequest } from "../middleware/auth";
import { requireCaseOwnership } from "../middleware/caseOwnership";
import { storage } from "../storage";
import { logAuditEvent, AuditEventTypes, getRequestMetadata } from "../services/auditLogger";
import type { RTWPlanStatus } from "@shared/schema";
import { getCaseRTWCompliance } from "../services/rtwCompliance";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Valid RTW plan status transitions
 * PRD-3.2.3: All transitions must be logged
 */
const VALID_TRANSITIONS: Record<RTWPlanStatus, RTWPlanStatus[]> = {
  not_planned: ["planned_not_started"],
  pending_employer_review: ["in_progress", "not_planned", "on_hold"],
  planned_not_started: ["in_progress", "on_hold", "not_planned", "pending_employer_review"],
  in_progress: ["working_well", "failing", "on_hold", "completed", "pending_employer_review"],
  working_well: ["in_progress", "completed", "on_hold"],
  failing: ["in_progress", "on_hold", "not_planned"],
  on_hold: ["planned_not_started", "in_progress", "not_planned"],
  completed: [], // Terminal state - no transitions out (admin override only)
};

/**
 * Validate RTW plan status transition
 */
function isValidTransition(from: RTWPlanStatus | undefined, to: RTWPlanStatus): boolean {
  // If no current status, treat as "not_planned"
  const currentStatus: RTWPlanStatus = from || "not_planned";

  // If same status, always valid (no-op)
  if (currentStatus === to) return true;

  return VALID_TRANSITIONS[currentStatus]?.includes(to) ?? false;
}

const RTW_STATUS_VALUES: RTWPlanStatus[] = [
  "not_planned",
  "planned_not_started",
  "in_progress",
  "working_well",
  "failing",
  "on_hold",
  "completed",
  "pending_employer_review",
];

const updateRtwStatusSchema = z.object({
  rtwPlanStatus: z.enum(RTW_STATUS_VALUES as [RTWPlanStatus, ...RTWPlanStatus[]]),
  reason: z.string().min(1, "Reason is required for status changes").max(500),
  forceTransition: z.boolean().optional().default(false),
});

/**
 * GET /api/cases/:id/rtw-plan
 * Returns the current RTW plan status for a case
 * PRD-3.2.3: Case lifecycle states
 */
router.get("/:id/rtw-plan", authorize(), requireCaseOwnership(), async (req: AuthRequest, res: Response) => {
  try {
    const workerCase = req.workerCase!;

    await logAuditEvent({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      eventType: AuditEventTypes.CASE_VIEW,
      resourceType: "rtw_plan",
      resourceId: workerCase.id,
      ...getRequestMetadata(req),
    });

    res.json({
      caseId: workerCase.id,
      workerName: workerCase.workerName,
      rtwPlanStatus: workerCase.rtwPlanStatus || "not_planned",
      medicalConstraints: workerCase.medicalConstraints,
      functionalCapacity: workerCase.functionalCapacity,
      workStatus: workerCase.workStatus,
      validTransitions: VALID_TRANSITIONS[workerCase.rtwPlanStatus || "not_planned"],
    });
  } catch (err) {
    logger.api.error("Failed to fetch RTW plan", {}, err);
    res.status(500).json({
      error: "Failed to fetch RTW plan",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * PUT /api/cases/:id/rtw-plan
 * Updates the RTW plan status for a case
 * PRD-3.2.3: Case lifecycle states, all transitions logged
 * PRD-3.4: Task & obligation engine integration
 */
router.put("/:id/rtw-plan", authorize(), requireCaseOwnership(), async (req: AuthRequest, res: Response) => {
  try {
    const workerCase = req.workerCase!;

    const validationResult = updateRtwStatusSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validationResult.error.errors,
      });
    }

    const { rtwPlanStatus, reason, forceTransition } = validationResult.data;
    const currentStatus = workerCase.rtwPlanStatus || "not_planned";

    // Check transition validity
    if (!forceTransition && !isValidTransition(currentStatus, rtwPlanStatus)) {
      return res.status(400).json({
        error: "Invalid status transition",
        details: `Cannot transition from '${currentStatus}' to '${rtwPlanStatus}'`,
        currentStatus,
        requestedStatus: rtwPlanStatus,
        validTransitions: VALID_TRANSITIONS[currentStatus],
      });
    }

    // Admin override for force transitions
    if (forceTransition && req.user!.role !== "admin") {
      return res.status(403).json({
        error: "Admin role required for forced transitions",
      });
    }

    // Update the clinical status with new RTW plan status
    await storage.updateClinicalStatus(workerCase.id, workerCase.organizationId, {
      rtwPlanStatus,
    });

    // When plan becomes active, clear any stale "No RTW plan" review actions
    const ACTIVE_STATUSES: RTWPlanStatus[] = ["in_progress", "working_well", "completed"];
    if (ACTIVE_STATUSES.includes(rtwPlanStatus as RTWPlanStatus)) {
      const caseActionsAll = await storage.getActionsByCase(workerCase.id, workerCase.organizationId);
      const staleRtwActions = caseActionsAll.filter(
        a => a.type === "review_case" &&
             a.status === "pending" &&
             (a.notes?.includes("RTW plan") || a.notes?.includes("No RTW"))
      );
      await Promise.all(
        staleRtwActions.map(a => storage.completeAction(a.id, req.user!.id, req.user!.email))
      );
    }

    // Log audit event with transition details
    await logAuditEvent({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      eventType: AuditEventTypes.CASE_UPDATE,
      resourceType: "rtw_plan",
      resourceId: workerCase.id,
      metadata: {
        previousStatus: currentStatus,
        newStatus: rtwPlanStatus,
        reason,
        forced: forceTransition,
      },
      ...getRequestMetadata(req),
    });

    const newStatus = rtwPlanStatus as RTWPlanStatus;
    res.json({
      success: true,
      caseId: workerCase.id,
      previousStatus: currentStatus,
      rtwPlanStatus: newStatus,
      validTransitions: VALID_TRANSITIONS[newStatus],
    });
  } catch (err) {
    logger.api.error("Failed to update RTW plan", {}, err);
    res.status(500).json({
      error: "Failed to update RTW plan",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * GET /api/rtw/overview
 * Returns RTW planning overview statistics across all cases
 * PRD-3.4: Task & obligation tracking
 */
router.get("/overview", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const cases = await storage.getCases(organizationId);

    const stats = {
      total: cases.length,
      offWork: cases.filter(c => c.workStatus === "Off work").length,
      notPlanned: cases.filter(c => !c.rtwPlanStatus || c.rtwPlanStatus === "not_planned").length,
      plannedNotStarted: cases.filter(c => c.rtwPlanStatus === "planned_not_started").length,
      inProgress: cases.filter(c => c.rtwPlanStatus === "in_progress").length,
      workingWell: cases.filter(c => c.rtwPlanStatus === "working_well").length,
      failing: cases.filter(c => c.rtwPlanStatus === "failing").length,
      onHold: cases.filter(c => c.rtwPlanStatus === "on_hold").length,
      completed: cases.filter(c => c.rtwPlanStatus === "completed").length,
    };

    await logAuditEvent({
      userId: req.user!.id,
      organizationId,
      eventType: AuditEventTypes.CASE_LIST,
      resourceType: "rtw_overview",
      ...getRequestMetadata(req),
    });

    res.json({
      stats,
      casesNeedingPlan: cases
        .filter(c => c.workStatus === "Off work" && (!c.rtwPlanStatus || c.rtwPlanStatus === "not_planned"))
        .map(c => ({
          id: c.id,
          workerName: c.workerName,
          company: c.company,
          dateOfInjury: c.dateOfInjury,
          daysOffWork: Math.floor((Date.now() - new Date(c.dateOfInjury).getTime()) / (1000 * 60 * 60 * 24)),
        })),
      failingPlans: cases
        .filter(c => c.rtwPlanStatus === "failing")
        .map(c => ({
          id: c.id,
          workerName: c.workerName,
          company: c.company,
        })),
    });
  } catch (err) {
    logger.api.error("Failed to fetch RTW overview", {}, err);
    res.status(500).json({
      error: "Failed to fetch RTW overview",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * GET /api/rtw/expiry-overview/:organizationId
 * Get RTW plan expiry overview for an organization
 */
router.get("/expiry-overview/:organizationId", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.params.organizationId as string;

    // Ensure user can access this organization
    if (req.user!.organizationId !== organizationId && req.user!.role !== "admin") {
      return res.status(403).json({ error: "Access denied to organization" });
    }

    logger.api.info("Fetching RTW expiry overview", { organizationId });

    const cases = await storage.getCases(organizationId);

    // Process all cases to get RTW compliance status
    const expiringCases = [];
    const expiredCases = [];

    for (const workerCase of cases) {
      try {
        const compliance = await getCaseRTWCompliance(storage, workerCase.id, organizationId);

        if (compliance.status === "plan_expiring_soon") {
          expiringCases.push({
            id: workerCase.id,
            workerName: workerCase.workerName,
            company: workerCase.company,
            rtwPlanStatus: workerCase.rtwPlanStatus,
            daysUntilExpiry: compliance.daysUntilExpiry,
            planDuration: compliance.activePlan?.expectedDurationWeeks,
          });
        } else if (compliance.status === "plan_expired") {
          expiredCases.push({
            id: workerCase.id,
            workerName: workerCase.workerName,
            company: workerCase.company,
            rtwPlanStatus: workerCase.rtwPlanStatus,
            daysSinceExpiry: compliance.daysSinceExpiry,
            planDuration: compliance.activePlan?.expectedDurationWeeks,
          });
        }
      } catch (error) {
        logger.api.warn("Failed to get RTW compliance for case", { caseId: workerCase.id }, error);
        // Continue processing other cases
      }
    }

    res.json({
      expiring: expiringCases,
      expired: expiredCases,
      totalAffected: expiringCases.length + expiredCases.length,
    });
  } catch (err) {
    logger.api.error("Failed to fetch RTW expiry overview", {}, err);
    res.status(500).json({
      error: "Failed to fetch RTW expiry overview",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * GET /api/cases/:id/rtw-compliance
 * Get RTW compliance status for a specific case
 */
router.get("/cases/:id/rtw-compliance", authorize(), requireCaseOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const caseId = req.params.id as string;
    const organizationId = req.user!.organizationId;

    logger.api.info("Fetching RTW compliance", { caseId, organizationId });

    const compliance = await getCaseRTWCompliance(storage, caseId, organizationId);

    res.json(compliance);
  } catch (err) {
    logger.api.error("Failed to fetch RTW compliance", { caseId: req.params.id }, err);
    res.status(500).json({
      error: "Failed to fetch RTW compliance",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * PUT /api/cases/:id/rtw-plan/extend
 * Extend RTW plan duration with audit logging
 */
const extendRtwPlanSchema = z.object({
  additionalWeeks: z.number().min(1).max(52),
  reason: z.string().optional(),
});

router.put("/cases/:id/rtw-plan/extend", authorize(), requireCaseOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const caseId = req.params.id as string;
    const organizationId = req.user!.organizationId;
    const { additionalWeeks, reason } = extendRtwPlanSchema.parse(req.body);

    logger.api.info("Extending RTW plan", { caseId, additionalWeeks, reason });

    // Get current case with clinical status
    const cases = await storage.getCases(organizationId);
    const workerCase = cases.find(c => c.id === caseId);
    if (!workerCase) {
      return res.status(404).json({ error: "Case not found" });
    }
    const clinicalStatus = workerCase.clinical_status_json;

    if (!clinicalStatus?.treatmentPlan) {
      return res.status(400).json({ error: "No treatment plan found to extend" });
    }

    // Update treatment plan duration
    const updatedTreatmentPlan = {
      ...clinicalStatus.treatmentPlan,
      expectedDurationWeeks: clinicalStatus.treatmentPlan.expectedDurationWeeks + additionalWeeks,
      // Update target end date if it exists
      rtwPlanTargetEndDate: clinicalStatus.treatmentPlan.rtwPlanTargetEndDate
        ? (() => {
            const currentEnd = new Date(clinicalStatus.treatmentPlan.rtwPlanTargetEndDate!);
            currentEnd.setDate(currentEnd.getDate() + (additionalWeeks * 7));
            return currentEnd.toISOString();
          })()
        : undefined,
      rtwPlanLastReviewDate: new Date().toISOString(),
    };

    // Update case with extended plan
    const updatedClinicalStatus = {
      ...clinicalStatus,
      treatmentPlan: updatedTreatmentPlan,
    };

    await storage.updateClinicalStatus(caseId, organizationId, updatedClinicalStatus);

    // Log audit event
    await logAuditEvent({
      eventType: AuditEventTypes.CASE_UPDATE,
      userId: req.user!.email,
      organizationId,
      metadata: getRequestMetadata(req),
    });

    res.json({
      success: true,
      newDurationWeeks: updatedTreatmentPlan.expectedDurationWeeks,
      newTargetEndDate: updatedTreatmentPlan.rtwPlanTargetEndDate,
      message: `RTW plan extended by ${additionalWeeks} weeks`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid request data",
        details: err.errors,
      });
    }

    logger.api.error("Failed to extend RTW plan", { caseId: req.params.id }, err);
    res.status(500).json({
      error: "Failed to extend RTW plan",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/cases/:id/rtw-assessment
 * Phase 8.1 — Records full RTW assessment from wizard, including pathway and consent.
 */
const rtwAssessmentSchema = z.object({
  pathway: z.string().optional(),
  pathwayRationale: z.string().optional(),
  targetStartDate: z.string().optional(),
  targetEndDate: z.string().optional(),
  initialHoursPerDay: z.number().optional(),
  initialDaysPerWeek: z.number().optional(),
  goalStatement: z.string().optional(),
  reviewDate: z.string().optional(),
  availableDuties: z.array(z.string()).optional(),
  excludedDuties: z.string().optional(),
  workplaceModifications: z.string().optional(),
  supervisorName: z.string().optional(),
  supervisorPhone: z.string().optional(),
  currentRestrictions: z.string().optional(),
  hoursPerDay: z.number().optional(),
  daysPerWeek: z.number().optional(),
  liftingLimitKg: z.number().nullable().optional(),
  // Consent (Phase 8.2)
  consentStatus: z.enum(["pending", "agreed", "agreed_with_conditions", "refused"]).optional(),
  consentMethod: z.enum(["verbal", "written", "email"]).optional(),
  consentConditions: z.string().optional(),
  consentRefusalReason: z.string().optional(),
  consentNotes: z.string().optional(),
});

router.post("/:id/rtw-assessment", authorize(), requireCaseOwnership(), async (req: AuthRequest, res: Response) => {
  try {
    const workerCase = req.workerCase!;
    const parsed = rtwAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid assessment data", details: parsed.error.errors });
    }

    const data = parsed.data;

    // Persist assessment data in clinical_status_json
    const existing = (workerCase.clinical_status_json ?? {}) as Record<string, unknown>;
    const updated = {
      ...existing,
      rtwAssessment: {
        pathway: data.pathway,
        pathwayRationale: data.pathwayRationale,
        targetStartDate: data.targetStartDate,
        targetEndDate: data.targetEndDate,
        initialHoursPerDay: data.initialHoursPerDay,
        initialDaysPerWeek: data.initialDaysPerWeek,
        goalStatement: data.goalStatement,
        reviewDate: data.reviewDate,
        availableDuties: data.availableDuties,
        excludedDuties: data.excludedDuties,
        workplaceModifications: data.workplaceModifications,
        supervisorName: data.supervisorName,
        supervisorPhone: data.supervisorPhone,
        currentRestrictions: data.currentRestrictions,
        recordedAt: new Date().toISOString(),
        recordedBy: req.user!.email,
      },
      rtwConsent: {
        status: data.consentStatus,
        method: data.consentMethod,
        conditions: data.consentConditions,
        refusalReason: data.consentRefusalReason,
        notes: data.consentNotes,
        recordedAt: new Date().toISOString(),
        recordedBy: req.user!.email,
      },
    };

    await storage.updateClinicalStatus(workerCase.id, workerCase.organizationId, updated as any);

    // If consent refused, create compliance action
    if (data.consentStatus === "refused") {
      await storage.upsertAction(
        workerCase.id,
        "follow_up",
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        "COMPLIANCE: Worker has refused RTW plan — review plan suitability and consider WorkSafe conciliation. (WIRC Act 2013, s82-83)"
      );
    }

    await logAuditEvent({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      eventType: AuditEventTypes.CASE_UPDATE,
      resourceType: "rtw_assessment",
      resourceId: workerCase.id,
      ...getRequestMetadata(req),
    });

    res.json({ success: true, message: "RTW assessment recorded." });
  } catch (err) {
    logger.api.error("Failed to record RTW assessment", { caseId: req.params.id }, err);
    res.status(500).json({ error: "Failed to record RTW assessment" });
  }
});

export default router;
