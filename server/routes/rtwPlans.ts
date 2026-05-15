/**
 * RTW Plans API Router
 * GEN-09: Preview plan (via recommend endpoint)
 * GEN-10: Save plan as draft (via POST endpoint)
 *
 * Provides HTTP interface for frontend wizard to get recommendations
 * and save draft plans with full validation.
 */

import { Router } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { storage } from "../storage";
import {
  recommendPlanType,
  filterDutiesForPlan,
  type DutySuitabilityInput,
} from "../services/planGenerator";
import {
  generateDefaultSchedule,
  validateCustomSchedule,
  generatePartialHoursSchedule,
  generateNormalHoursSchedule,
} from "../services/scheduleCalculator";
import { calculateDutySuitability } from "../services/functionalAbilityCalculator";
import { generateModificationSuggestions } from "../services/modificationSuggester";
import { logAuditEvent, getRequestMetadata } from "../services/auditLogger";
import { logger } from "../lib/logger";
import { generateRTWPlanEmail, type RTWPlanEmailContext } from "../services/rtwEmailService";
import { sendEmail } from "../services/emailService";
import { format } from "date-fns";

const router = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const recommendQuerySchema = z.object({
  caseId: z.string().min(1, "caseId required"),
  roleId: z.string().min(1, "roleId required"),
});

const createPlanSchema = z.object({
  caseId: z.string().min(1),
  roleId: z.string().min(1),
  planType: z.enum(["normal_hours", "partial_hours", "graduated_return"]),
  startDate: z.string(),
  schedule: z.array(z.object({
    weekNumber: z.number().min(1),
    hoursPerDay: z.number().min(1).max(12),
    daysPerWeek: z.number().min(1).max(7),
  })).min(1, "At least one week required"),
  selectedDutyIds: z.array(z.string()).min(1, "At least one duty required"),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/rtw-plans/recommend
 * GEN-01, GEN-02, GEN-03: Get plan type recommendation and default schedule
 *
 * Returns plan type recommendation, default schedule based on plan type,
 * and filtered duties with suitability assessments.
 */
router.get("/recommend", async (req: AuthRequest, res) => {
  try {
    // Validate query parameters
    const queryResult = recommendQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: queryResult.error.errors,
      });
    }

    const { caseId, roleId } = queryResult.data;
    const organizationId = req.user!.organizationId;

    // Get current restrictions for case
    const restrictionsResult = await storage.getCurrentRestrictions(caseId, organizationId);
    if (!restrictionsResult) {
      return res.status(404).json({
        error: "No current restrictions found for this case",
        hint: "Ensure a valid medical certificate with extracted restrictions exists",
      });
    }

    // Get duties for role with demands
    const duties = await storage.getRoleDutiesWithDemands(roleId, organizationId);
    if (duties.length === 0) {
      return res.status(404).json({
        error: "No duties found for this role",
        hint: "Add duties to the role before generating a plan",
      });
    }

    // Calculate suitability for each duty
    const dutySuitability: DutySuitabilityInput[] = duties.map(duty => {
      const result = calculateDutySuitability(
        duty.demands,
        restrictionsResult.restrictions,
        duty.isModifiable
      );
      const suggestions = generateModificationSuggestions({
        dutyName: duty.name,
        dutyDescription: duty.description || "",
        demandComparisons: result.demandComparisons,
        isModifiable: duty.isModifiable,
      });
      return {
        duty,
        suitability: result.overallSuitability,
        modificationSuggestions: suggestions,
      };
    });

    // Get plan type recommendation
    const recommendation = recommendPlanType(restrictionsResult.restrictions, dutySuitability);

    // Generate appropriate schedule based on plan type
    const scheduleConfig = {
      startDate: new Date(),
      restrictionReviewDate: restrictionsResult.restrictions.nextExaminationDate
        ? new Date(restrictionsResult.restrictions.nextExaminationDate)
        : null,
      maxHoursPerDay: restrictionsResult.maxWorkHoursPerDay,
      maxDaysPerWeek: restrictionsResult.maxWorkDaysPerWeek,
    };

    let defaultSchedule;
    switch (recommendation.planType) {
      case "normal_hours":
        defaultSchedule = generateNormalHoursSchedule(scheduleConfig);
        break;
      case "partial_hours":
        defaultSchedule = generatePartialHoursSchedule(scheduleConfig);
        break;
      case "graduated_return":
      default:
        defaultSchedule = generateDefaultSchedule(scheduleConfig);
        break;
    }

    // Filter duties for inclusion
    const filteredDuties = filterDutiesForPlan(dutySuitability, true);

    logger.api.info("Generated RTW plan recommendation", {
      caseId,
      roleId,
      planType: recommendation.planType,
      dutiesCount: duties.length,
      includedDuties: filteredDuties.filter(d => d.isIncluded).length,
    });

    res.json({
      success: true,
      data: {
        recommendation,
        defaultSchedule: defaultSchedule.map(week => ({
          weekNumber: week.weekNumber,
          hoursPerDay: week.hoursPerDay,
          daysPerWeek: week.daysPerWeek,
          totalHoursPerWeek: week.totalHoursPerWeek,
          startDate: week.startDate.toISOString(),
          endDate: week.endDate.toISOString(),
          notes: week.notes,
        })),
        restrictionReviewDate: restrictionsResult.restrictions.nextExaminationDate || null,
        restrictions: {
          maxHoursPerDay: restrictionsResult.maxWorkHoursPerDay,
          maxDaysPerWeek: restrictionsResult.maxWorkDaysPerWeek,
        },
        duties: filteredDuties.map(d => ({
          dutyId: d.dutyId,
          dutyName: d.dutyName,
          suitability: d.suitability,
          isIncluded: d.isIncluded,
          modificationNotes: d.modificationNotes,
          excludedReason: d.excludedReason,
        })),
      },
    });
  } catch (err) {
    logger.api.error("RTW plan recommendation failed", {
      caseId: req.query.caseId,
      roleId: req.query.roleId,
    }, err);
    res.status(500).json({
      error: "Failed to generate recommendation",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/rtw-plans
 * GEN-10: Save plan as draft
 *
 * Creates a new RTW plan with version 1 in draft status.
 * Validates duties are suitable and schedule respects restrictions.
 */
router.post("/", async (req: AuthRequest, res) => {
  try {
    // Validate request body
    const bodyResult = createPlanSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: bodyResult.error.errors,
      });
    }

    const planData = bodyResult.data;
    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;

    // Verify case belongs to organization
    const workerCase = await storage.getGPNet2CaseById(planData.caseId, organizationId);
    if (!workerCase) {
      return res.status(404).json({ error: "Case not found" });
    }

    // Get restrictions and validate schedule
    const restrictionsResult = await storage.getCurrentRestrictions(planData.caseId, organizationId);
    if (!restrictionsResult) {
      return res.status(400).json({
        error: "No current restrictions - cannot create plan",
        hint: "Ensure a valid medical certificate exists for this case",
      });
    }

    // Validate schedule against restrictions
    const scheduleForValidation = planData.schedule.map(s => ({
      weekNumber: s.weekNumber,
      hoursPerDay: s.hoursPerDay,
      daysPerWeek: s.daysPerWeek,
      totalHoursPerWeek: s.hoursPerDay * s.daysPerWeek,
      startDate: new Date(planData.startDate),
      endDate: new Date(planData.startDate),
    }));

    const restrictionReviewDate = restrictionsResult.restrictions.nextExaminationDate
      ? new Date(restrictionsResult.restrictions.nextExaminationDate)
      : null;

    const scheduleValidation = validateCustomSchedule(
      scheduleForValidation,
      restrictionsResult.restrictions,
      restrictionReviewDate
    );

    if (!scheduleValidation.valid) {
      return res.status(400).json({
        error: "Schedule validation failed",
        details: scheduleValidation.errors,
        warnings: scheduleValidation.warnings,
      });
    }

    // Get selected duties and verify suitability
    const duties = await storage.getDutiesByIds(planData.selectedDutyIds, organizationId);
    if (duties.length !== planData.selectedDutyIds.length) {
      const foundIds = duties.map(d => d.id);
      const missingIds = planData.selectedDutyIds.filter(id => !foundIds.includes(id));
      return res.status(400).json({
        error: "One or more selected duties not found",
        details: { missingDutyIds: missingIds },
      });
    }

    // Verify no not_suitable duties included
    const dutySuitabilityChecks = duties.map(duty => {
      const result = calculateDutySuitability(
        duty.demands,
        restrictionsResult.restrictions,
        duty.isModifiable
      );
      return {
        duty,
        suitability: result.overallSuitability,
      };
    });

    const notSuitable = dutySuitabilityChecks.filter(d => d.suitability === "not_suitable");
    if (notSuitable.length > 0) {
      return res.status(400).json({
        error: "Plan includes not-suitable duties",
        details: notSuitable.map(d => ({
          dutyId: d.duty.id,
          dutyName: d.duty.name,
        })),
      });
    }

    // Build duty list for plan creation
    const dutySuitabilityInputs: DutySuitabilityInput[] = dutySuitabilityChecks.map(d => ({
      duty: d.duty,
      suitability: d.suitability,
      modificationSuggestions: [],
    }));

    const filteredDuties = filterDutiesForPlan(dutySuitabilityInputs, true);

    // Create plan using storage method
    const result = await storage.createRTWPlan({
      organizationId,
      caseId: planData.caseId,
      roleId: planData.roleId,
      planType: planData.planType,
      startDate: new Date(planData.startDate),
      restrictionReviewDate,
      createdBy: userId,
      schedule: planData.schedule as any,
      duties: filteredDuties,
    });

    // Log audit event
    await logAuditEvent({
      userId,
      organizationId,
      eventType: "case.create" as any, // RTW plan creation - using closest available type
      resourceType: "rtw_plan",
      resourceId: result.planId,
      metadata: {
        caseId: planData.caseId,
        planType: planData.planType,
        weekCount: planData.schedule.length,
        dutyCount: planData.selectedDutyIds.length,
        versionId: result.versionId,
      },
      ...getRequestMetadata(req),
    });

    logger.api.info("RTW plan created", {
      planId: result.planId,
      versionId: result.versionId,
      caseId: planData.caseId,
      planType: planData.planType,
    });

    res.status(201).json({
      success: true,
      planId: result.planId,
      versionId: result.versionId,
      message: "RTW plan created as draft",
    });
  } catch (err) {
    logger.api.error("RTW plan creation failed", {
      caseId: req.body?.caseId,
    }, err);
    res.status(500).json({
      error: "Failed to create plan",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * GET /api/rtw-plans?caseId=X
 * Get the latest RTW plan for a case (for employer approval preview)
 */
router.get("/", async (req: AuthRequest, res) => {
  try {
    const { caseId } = req.query;
    if (!caseId || typeof caseId !== "string") {
      return res.status(400).json({ error: "caseId query parameter required" });
    }

    const organizationId = req.user!.organizationId;
    const plan = await storage.getLatestRTWPlanByCase(caseId, organizationId);
    if (!plan) {
      return res.status(404).json({ error: "No RTW plan found for this case" });
    }

    res.json({ success: true, data: plan });
  } catch (err) {
    logger.api.error("RTW plan list by case failed", { caseId: req.query.caseId }, err);
    res.status(500).json({ error: "Failed to fetch plan", details: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/rtw-plans/:planId
 * Get plan details by ID
 */
router.get("/:planId", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const organizationId = req.user!.organizationId;

    const plan = await storage.getRTWPlanById(planId, organizationId);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    res.json({
      success: true,
      data: plan,
    });
  } catch (err) {
    logger.api.error("RTW plan get failed", {
      planId: req.params.planId,
    }, err);
    res.status(500).json({
      error: "Failed to get plan",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ============================================================================
// Plan Output Endpoints (OUT-01 to OUT-08)
// ============================================================================

const VALID_CAPABILITIES = new Set([
  "can",
  "cannot",
  "with_modifications",
  "not_assessed",
]);

function flatRestrictionsToArray(
  r: unknown,
): Array<{ category: string; capability: string; notes: null }> {
  if (!r) return [];
  if (Array.isArray(r)) return r as Array<{ category: string; capability: string; notes: null }>;
  if (typeof r !== "object") return [];
  return Object.entries(r as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" && VALID_CAPABILITIES.has(v))
    .map(([category, capability]) => ({
      category,
      capability: capability as string,
      notes: null,
    }));
}

/**
 * GET /api/rtw-plans/:planId/details
 * OUT-01 to OUT-06: Get complete plan with case, role, restrictions context
 *
 * Returns enriched plan data for display including:
 * - Worker case info (name, company, injury date)
 * - Role info
 * - Current restrictions
 * - Schedule
 * - Duties with demands for matrix display
 */
router.get("/:planId/details", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const organizationId = req.user!.organizationId;

    const details = await storage.getRTWPlanFullDetails(planId, organizationId);
    if (!details) {
      return res.status(404).json({ error: "Plan not found" });
    }

    logger.api.info("Fetched RTW plan details", {
      planId,
      hasWorkerCase: !!details.workerCase,
      hasRole: !!details.role,
      hasRestrictions: !!details.restrictions,
      dutiesCount: details.duties.length,
    });

    res.json({
      success: true,
      data: {
        plan: {
          id: details.plan.id,
          caseId: details.plan.caseId,
          roleId: details.plan.roleId,
          planType: details.plan.planType,
          status: details.plan.status,
          version: details.plan.version,
          startDate: details.plan.startDate?.toISOString() || null,
          restrictionReviewDate: details.plan.restrictionReviewDate?.toISOString() || null,
          createdAt: details.plan.createdAt?.toISOString() || null,
        },
        version: details.version ? {
          id: details.version.id,
          versionNumber: details.version.version,
          dataJson: details.version.dataJson,
        } : null,
        schedule: details.schedule.map(s => ({
          weekNumber: s.weekNumber,
          hoursPerDay: s.hoursPerDay,
          daysPerWeek: s.daysPerWeek,
        })),
        duties: details.duties.map(d => ({
          dutyId: d.dutyId,
          dutyName: d.dutyName,
          dutyDescription: d.dutyDescription,
          suitability: d.suitability,
          modificationNotes: d.modificationNotes,
          isIncluded: d.suitability !== "not_suitable",
          excludedReason: d.excludedReason,
          demands: d.demands ? {
            sitting: d.demands.sitting,
            standing: d.demands.standing,
            walking: d.demands.walking,
            bending: d.demands.bending,
            squatting: d.demands.squatting,
            kneeling: d.demands.kneeling,
            twisting: d.demands.twisting,
            reachingOverhead: d.demands.reachingOverhead,
            reachingForward: d.demands.reachingForward,
            lifting: d.demands.lifting,
            liftingMaxKg: d.demands.liftingMaxKg,
            carrying: d.demands.carrying,
            carryingMaxKg: d.demands.carryingMaxKg,
            repetitiveMovements: d.demands.repetitiveMovements,
            concentration: d.demands.concentration,
            stressTolerance: d.demands.stressTolerance,
            workPace: d.demands.workPace,
          } : null,
        })),
        workerCase: details.workerCase,
        role: details.role,
        restrictions: flatRestrictionsToArray(details.restrictions),
        maxHoursPerDay: details.maxHoursPerDay,
        maxDaysPerWeek: details.maxDaysPerWeek,
      },
    });
  } catch (err) {
    logger.api.error("RTW plan details fetch failed", {
      planId: req.params.planId,
    }, err);
    res.status(500).json({
      error: "Failed to fetch plan details",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * Helper: Build email context from plan details
 */
function buildEmailContext(details: Awaited<ReturnType<typeof storage.getRTWPlanFullDetails>>): RTWPlanEmailContext | null {
  if (!details || !details.workerCase || !details.role) {
    return null;
  }

  const includedDuties = details.duties
    .filter(d => d.suitability !== "not_suitable")
    .map(d => ({
      dutyName: d.dutyName,
      suitability: d.suitability,
      modificationNotes: d.modificationNotes,
    }));

  const excludedDuties = details.duties
    .filter(d => d.suitability === "not_suitable")
    .map(d => ({
      dutyName: d.dutyName,
      excludedReason: d.excludedReason,
    }));

  return {
    workerName: details.workerCase.workerName,
    company: details.workerCase.company,
    dateOfInjury: details.workerCase.dateOfInjury,
    workStatus: details.workerCase.workStatus,
    roleName: details.role.name,
    roleDescription: details.role.description,
    planType: details.plan.planType,
    planStatus: details.plan.status,
    startDate: details.plan.startDate
      ? format(details.plan.startDate, "d MMMM yyyy")
      : "Not set",
    restrictionReviewDate: details.plan.restrictionReviewDate
      ? format(details.plan.restrictionReviewDate, "d MMMM yyyy")
      : null,
    schedule: details.schedule.map(s => ({
      weekNumber: s.weekNumber,
      hoursPerDay: Number(s.hoursPerDay),
      daysPerWeek: s.daysPerWeek,
    })),
    includedDuties,
    excludedDuties,
    maxHoursPerDay: details.maxHoursPerDay,
    maxDaysPerWeek: details.maxDaysPerWeek,
  };
}

/**
 * GET /api/rtw-plans/:planId/email
 * OUT-07: Get or generate manager notification email
 *
 * Returns existing email draft if available, otherwise generates new one.
 */
router.get("/:planId/email", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const organizationId = req.user!.organizationId;

    // Check for existing email draft
    const existingEmail = await storage.getPlanEmail(planId);
    if (existingEmail) {
      logger.api.info("Returning existing RTW plan email", { planId });
      return res.json({
        success: true,
        data: existingEmail,
        cached: true,
      });
    }

    // Generate new email
    const details = await storage.getRTWPlanFullDetails(planId, organizationId);
    if (!details) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const emailContext = buildEmailContext(details);
    if (!emailContext) {
      return res.status(400).json({
        error: "Cannot generate email - missing worker case or role data",
      });
    }

    // Pass organizationId for template lookup (EMAIL-09)
    const email = await generateRTWPlanEmail(emailContext, organizationId);

    // Save generated email
    await storage.savePlanEmail(planId, email);

    logger.api.info("Generated RTW plan email", {
      planId,
      workerName: emailContext.workerName,
      organizationId,
    });

    res.json({
      success: true,
      data: email,
      cached: false,
    });
  } catch (err) {
    logger.api.error("RTW plan email fetch failed", {
      planId: req.params.planId,
    }, err);
    res.status(500).json({
      error: "Failed to get/generate email",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/rtw-plans/:planId/email/regenerate
 * OUT-08: Force regenerate manager notification email
 *
 * Always generates fresh email, replacing any existing draft.
 * Only allowed when plan.status !== 'approved'
 */
router.post("/:planId/email/regenerate", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const organizationId = req.user!.organizationId;

    // Get plan details
    const details = await storage.getRTWPlanFullDetails(planId, organizationId);
    if (!details) {
      return res.status(404).json({ error: "Plan not found" });
    }

    // Check plan status - cannot regenerate for approved plans (OUT-08)
    if (details.plan.status === "approved") {
      return res.status(403).json({
        error: "Cannot regenerate email for approved plan",
        hint: "Email is locked after plan approval",
      });
    }

    const emailContext = buildEmailContext(details);
    if (!emailContext) {
      return res.status(400).json({
        error: "Cannot generate email - missing worker case or role data",
      });
    }

    // Generate fresh email with organizationId for template lookup (EMAIL-09)
    const email = await generateRTWPlanEmail(emailContext, organizationId);

    // Save (overwrites existing)
    await storage.savePlanEmail(planId, email);

    logger.api.info("Regenerated RTW plan email", {
      planId,
      workerName: emailContext.workerName,
      organizationId,
    });

    res.json({
      success: true,
      data: email,
      regenerated: true,
    });
  } catch (err) {
    logger.api.error("RTW plan email regeneration failed", {
      planId: req.params.planId,
    }, err);
    res.status(500).json({
      error: "Failed to regenerate email",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/rtw-plans/:planId/email/send
 * Send RTW plan notification email to manager (EMAIL-10)
 */
router.post("/:planId/email/send", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const { recipientEmail, subject, body } = req.body;

    if (!recipientEmail || !subject || !body) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: recipientEmail, subject, body",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email address format",
      });
    }

    const organizationId = req.user!.organizationId;
    const plan = await storage.getRTWPlanById(planId, organizationId);
    if (!plan) {
      return res.status(404).json({ success: false, error: "Plan not found" });
    }

    const result = await sendEmail({ to: recipientEmail, subject, body });

    if (!result.success) {
      logger.api.error("Failed to send RTW plan email", { planId, recipientEmail, error: result.error });
      return res.status(500).json({ success: false, error: result.error || "Failed to send email" });
    }

    await logAuditEvent({
      userId: req.user?.id ?? null,
      organizationId: req.user?.organizationId ?? null,
      eventType: "case.update" as any, // RTW plan email sent
      resourceType: "rtw_plan",
      resourceId: planId,
      metadata: { recipientEmail, subject, messageId: result.messageId, sentAt: new Date().toISOString() },
      ...getRequestMetadata(req),
    });

    logger.api.info("RTW plan email sent successfully", { planId, recipientEmail, messageId: result.messageId });

    return res.json({ success: true, data: { messageId: result.messageId, recipientEmail } });
  } catch (err) {
    logger.api.error("Error sending RTW plan email", { planId: req.params.planId }, err);
    return res.status(500).json({ success: false, error: "Failed to send email" });
  }
});

export default router;
