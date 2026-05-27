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
import { sendEmail, type SendEmailResult } from "../services/emailService";
import {
  resolveRecipients,
  buildDistributionPreview,
  computeDistributionStatus,
  RecipientResolutionError,
  type DistributionTrackingRecord,
  type RTWRecipientRole,
} from "../services/rtwPlanDistribution";
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

// ============================================================================
// RTW Multi-Party Distribution — phase 2 routes
// Spec: agent-specs/rtw-plan-multi-party-distribution.md
// Pattern mirrors server/routes/employer-dashboard.ts:631-756 (/draft + /send).
// ============================================================================

const distributeRecipientSchema = z.object({
  contactId: z.string().nullable(), // null for worker (worker email lives on worker_cases)
  role: z.enum(["worker", "manager", "doctor", "physio", "insurer"]),
  // `to` is accepted for forward-compat with edit-before-send UX but is IGNORED
  // server-side — the actual recipient email is re-resolved from contactId/role
  // against case_contacts / worker_cases to prevent recipient tampering (a
  // practitioner with edit access to the modal could otherwise exfiltrate the
  // plan to an arbitrary address). To change a recipient's email, edit it on
  // the case-contacts page.
  to: z.string().email(),
  // Subject regex blocks CRLF for header-injection defense-in-depth. Resend/
  // nodemailer both already encode, but cheap to enforce at validation too.
  subject: z.string().min(1).max(200).regex(/^[^\r\n]*$/, "Subject cannot contain newlines"),
  body: z.string().min(1).max(20000),
  include: z.boolean(),
});

const distributeSendSchema = z.object({
  recipients: z.array(distributeRecipientSchema).min(1).max(10),
});

const markResponseSchema = z.object({
  planId: z.string().min(1),
  responseText: z.string().min(1).max(20000),
});

const approveSchema = z.object({
  bypassReason: z.string().min(1).max(1000).optional(),
});

function mapResolutionErrorToHttp(err: RecipientResolutionError): {
  status: number;
  body: { error: string; code: string };
} {
  return {
    status: 400,
    body: { error: err.message, code: err.code },
  };
}

/**
 * Build the per-contact distribution tracking records the status-computer expects.
 * Worker's tracking row (contactId=null) is omitted in v1; status is computed
 * from gating contact rows only. If no worker contact-row exists, the worker's
 * gating state is currently un-tracked in v1 (manual-mark UX requires the
 * practitioner to create a worker contact row or mark via the worker-case
 * inbound-reply flow in v2). This matches the spec's v1-manual-paste model.
 */
function buildTrackingRecords(
  recipients: Array<{ role: RTWRecipientRole; contactId: string | null; isGating: boolean }>,
  contactsById: Map<string, { lastDistributedAt: Date | null; respondedAt: Date | null }>,
): DistributionTrackingRecord[] {
  const out: DistributionTrackingRecord[] = [];
  for (const r of recipients) {
    if (r.contactId === null) continue; // worker (no contact row in v1)
    const tracked = contactsById.get(r.contactId);
    out.push({
      role: r.role,
      isGating: r.isGating,
      lastDistributedAt: tracked?.lastDistributedAt ?? null,
      respondedAt: tracked?.respondedAt ?? null,
    });
  }
  return out;
}

/**
 * POST /api/rtw-plans/:planId/distribute/preview
 *
 * Resolves recipients deterministically; if missing required contacts, returns
 * 400 with the resolution-error code so the UI can point the practitioner at
 * the case-contacts page. Otherwise returns per-recipient {to, subject, body}
 * envelopes pre-populated from per-role templates + the canonical plan body.
 */
router.post("/:planId/distribute/preview", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const organizationId = req.user!.organizationId;

    const details = await storage.getRTWPlanFullDetails(planId, organizationId);
    if (!details) return res.status(404).json({ error: "Plan not found" });

    const context = await storage.getCaseDistributionContext(details.plan.caseId!, organizationId);
    if (!context) return res.status(404).json({ error: "Case not found" });

    let recipients;
    try {
      recipients = resolveRecipients({
        workerName: context.workerName,
        workerEmail: context.workerEmail,
        claimNumber: context.claimNumber,
        contacts: context.contacts.map((c) => ({
          id: c.id,
          role: c.role,
          name: c.name,
          email: c.email,
          isActive: c.isActive,
        })),
      });
    } catch (err) {
      if (err instanceof RecipientResolutionError) {
        const mapped = mapResolutionErrorToHttp(err);
        return res.status(mapped.status).json(mapped.body);
      }
      throw err;
    }

    // Reuse the canonical plan email body (one version, not per-party in v1)
    let planEmail = await storage.getPlanEmail(planId);
    if (!planEmail) {
      const emailContext = buildEmailContext(details);
      if (!emailContext) {
        return res.status(400).json({ error: "Cannot generate plan body - missing case or role data" });
      }
      planEmail = await generateRTWPlanEmail(emailContext, organizationId);
      await storage.savePlanEmail(planId, planEmail);
    }

    const preview = buildDistributionPreview({
      recipients,
      workerName: context.workerName,
      companyName: context.companyName,
      claimNumber: context.claimNumber,
      planBody: planEmail.body,
      subject: planEmail.subject,
    });

    return res.json({
      success: true,
      data: {
        planStatus: details.plan.status,
        distributionStatus: details.plan.distributionStatus,
        recipients: preview,
      },
    });
  } catch (err) {
    logger.api.error("RTW plan distribute/preview failed", { planId: req.params.planId }, err);
    return res.status(500).json({
      error: "Failed to build distribution preview",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/rtw-plans/:planId/distribute/send
 *
 * Zod-validates each per-recipient envelope, sends in parallel via
 * Promise.allSettled, marks each successful recipient as lastDistributedAt=now,
 * sets plan distribution_status='awaiting_responses' if any send succeeded.
 * Returns per-recipient send status so the UI can show partial-failure retries.
 */
router.post("/:planId/distribute/send", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const organizationId = req.user!.organizationId;
    const userEmail = req.user!.email;

    const parsed = distributeSendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
    }

    const plan = await storage.getRTWPlanById(planId, organizationId);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    // Same-case multi-plan guard (council finding): per-contact tracking on
    // case_contacts has no planId link in v1, so distributing plan v2 while
    // plan v1 is mid-cycle would silently corrupt plan v1's tracking state.
    // Refuse until the sibling distributions table lands in v2.
    const otherActive = await storage.hasOtherDistributedPlansOnCase(
      plan.plan.caseId!,
      organizationId,
      planId,
    );
    if (otherActive) {
      return res.status(409).json({
        error:
          "Another RTW plan on this case is mid-distribution. Finalise or reset it before distributing a new plan.",
        code: "OTHER_PLAN_MID_DISTRIBUTION",
      });
    }

    // Re-resolve recipients server-side so the canonical email addresses come
    // from the database, not from the client-editable payload. The Zod schema
    // accepts `to` for forward-compat with the edit-before-send UX but it is
    // IGNORED here — practitioner-edited `to` would be a recipient-tampering
    // vector (plan body contains worker health data).
    const context = await storage.getCaseDistributionContext(plan.plan.caseId!, organizationId);
    if (!context) return res.status(404).json({ error: "Case not found" });

    // Auto-upsert a 'worker' case_contacts row if absent so worker
    // lastDistributedAt and respondedAt have a home. organizationId is
    // pinned from the loaded case, not from req.user, per security review.
    if (context.workerEmail) {
      await storage.ensureWorkerContact(plan.plan.caseId!, organizationId, {
        workerName: context.workerName,
        workerEmail: context.workerEmail,
      });
    }

    // Re-fetch context post-upsert so the worker row is in the contacts list.
    const refreshedContext =
      (await storage.getCaseDistributionContext(plan.plan.caseId!, organizationId))!;

    let resolved;
    try {
      resolved = resolveRecipients({
        workerName: refreshedContext.workerName,
        workerEmail: refreshedContext.workerEmail,
        claimNumber: refreshedContext.claimNumber,
        contacts: refreshedContext.contacts.map((c) => ({
          id: c.id,
          role: c.role,
          name: c.name,
          email: c.email,
          isActive: c.isActive,
        })),
      });
    } catch (err) {
      if (err instanceof RecipientResolutionError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
    // After ensureWorkerContact above, the resolver should return a worker
    // recipient with a real contactId. Map by (role, contactId) for lookup.
    const resolvedByKey = new Map<string, { email: string; contactId: string | null }>();
    for (const r of resolved) {
      resolvedByKey.set(`${r.role}:${r.contactId ?? "_"}`, {
        email: r.email,
        contactId: r.contactId,
      });
    }
    // Worker case_contacts row id (resolver returns contactId for it now that
    // ensureWorkerContact ran). Used to track worker send + response.
    const workerContactRow = refreshedContext.contacts.find((c) => c.role === "worker");

    const enabled = parsed.data.recipients.filter((r) => r.include);
    if (enabled.length === 0) {
      return res.status(400).json({ error: "At least one recipient must be enabled" });
    }

    const sendResults = await Promise.allSettled(
      enabled.map((r) => {
        // Server-resolved email (ignore client-supplied `to`)
        const lookupKey = `${r.role}:${r.contactId ?? "_"}`;
        const serverResolved = resolvedByKey.get(lookupKey);
        const to = serverResolved?.email ?? null;
        if (!to) {
          const mismatchResult: SendEmailResult = {
            success: false,
            error: `Recipient ${r.role} is not a valid distribution target for this plan (re-resolve mismatch).`,
          };
          return Promise.resolve({ recipient: r, result: mismatchResult });
        }
        return sendEmail({
          to,
          subject: r.subject,
          body: r.body,
          replyTo: userEmail, // case manager receives replies — spec §3
        }).then((result) => ({ recipient: r, result }));
      }),
    );

    const perRecipient: Array<{
      contactId: string | null;
      role: string;
      success: boolean;
      messageId: string | null;
      error: string | null;
    }> = [];

    for (let i = 0; i < sendResults.length; i++) {
      const r = enabled[i];
      const settled = sendResults[i];
      if (settled.status === "fulfilled" && settled.value.result.success) {
        // Track per-contact send. Worker uses the (now-existing) worker case_contacts row.
        const trackContactId =
          r.role === "worker" ? workerContactRow?.id ?? null : r.contactId;
        if (trackContactId) {
          await storage.markContactDistributed(trackContactId, organizationId);
        }
        await logAuditEvent({
          userId: req.user?.id ?? null,
          organizationId: req.user?.organizationId ?? null,
          eventType: "rtw_plan.distributed" as any,
          resourceType: "rtw_plan",
          resourceId: planId,
          metadata: {
            // PII redaction: do NOT log `to` (recipient email is identifying
            // health PII in the WorkCover context). role + contactId + messageId
            // are enough to audit who got what and when.
            role: r.role,
            contactId: trackContactId,
            messageId: settled.value.result.messageId,
            sentAt: new Date().toISOString(),
          },
          ...getRequestMetadata(req),
        });
        perRecipient.push({
          contactId: trackContactId,
          role: r.role,
          success: true,
          messageId: settled.value.result.messageId ?? null,
          error: null,
        });
      } else {
        const errMsg =
          settled.status === "rejected"
            ? settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason)
            : settled.value.result.error || "Send failed";
        perRecipient.push({
          contactId: r.role === "worker" ? workerContactRow?.id ?? null : r.contactId,
          role: r.role,
          success: false,
          messageId: null,
          error: errMsg,
        });
      }
    }

    // Transition the plan status based on the FULL post-send tracking state.
    // computeDistributionStatus enforces the all-gating-distributed gate, so a
    // partial-success send (some gating recipients failed) correctly stays at
    // 'not_distributed' rather than hanging at 'awaiting_responses' forever.
    const postSendContext =
      (await storage.getCaseDistributionContext(plan.plan.caseId!, organizationId))!;
    const trackingByContactId = new Map<
      string,
      { lastDistributedAt: Date | null; respondedAt: Date | null }
    >();
    for (const c of postSendContext.contacts) {
      trackingByContactId.set(c.id, {
        lastDistributedAt: c.lastDistributedAt,
        respondedAt: c.respondedAt,
      });
    }
    const tracking: DistributionTrackingRecord[] = resolved
      .filter((r) => r.contactId !== null)
      .map((r) => {
        const t = trackingByContactId.get(r.contactId!);
        return {
          role: r.role,
          isGating: r.isGating,
          lastDistributedAt: t?.lastDistributedAt ?? null,
          respondedAt: t?.respondedAt ?? null,
        };
      });
    const nextStatus = computeDistributionStatus(plan.plan.distributionStatus, tracking);
    if (nextStatus !== plan.plan.distributionStatus) {
      await storage.updatePlanDistributionStatus(planId, organizationId, nextStatus);
    }

    return res.json({
      success: perRecipient.some((r) => r.success),
      data: {
        planId,
        distributionStatus: nextStatus,
        recipients: perRecipient,
      },
    });
  } catch (err) {
    logger.api.error("RTW plan distribute/send failed", { planId: req.params.planId }, err);
    return res.status(500).json({
      error: "Failed to distribute plan",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/rtw-plans/:planId/responses/:contactId/mark
 *
 * Practitioner-driven (v1 manual paste): record a recipient's response text
 * and recompute the plan's distribution_status. If all gating parties have
 * now responded, transitions to 'all_responded'.
 *
 * Security: contact must belong to the same case as the plan AND the user's
 * organization. The URL is plan-anchored to make IDOR enumeration of
 * arbitrary contact IDs harder; the contact.caseId === plan.caseId check
 * below closes the cross-case window inside the org.
 */
const markResponseUrlSchema = z.object({
  responseText: z.string().min(1).max(20000),
});

router.post("/:planId/responses/:contactId/mark", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const contactId = req.params.contactId as string;
    const organizationId = req.user!.organizationId;

    const parsed = markResponseUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
    }

    const plan = await storage.getRTWPlanById(planId, organizationId);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    // Verify the contact belongs to the plan's case before mutating it.
    // Without this check, a user in org A could mark responses on any contact
    // ID they guessed (IDOR — security review HIGH finding).
    const contactPreCheck = await storage.getCaseContactById(contactId, organizationId);
    if (!contactPreCheck || contactPreCheck.caseId !== plan.plan.caseId) {
      return res.status(404).json({ error: "Contact not found for this plan" });
    }

    const updated = await storage.markContactResponded(
      contactId,
      organizationId,
      parsed.data.responseText,
    );
    if (!updated) return res.status(404).json({ error: "Contact not found" });

    const context = await storage.getCaseDistributionContext(plan.plan.caseId!, organizationId);
    if (!context) return res.status(404).json({ error: "Case not found" });

    let recipients;
    try {
      recipients = resolveRecipients({
        workerName: context.workerName,
        workerEmail: context.workerEmail,
        claimNumber: context.claimNumber,
        contacts: context.contacts.map((c) => ({
          id: c.id,
          role: c.role,
          name: c.name,
          email: c.email,
          isActive: c.isActive,
        })),
      });
    } catch {
      // If recipients can't be resolved (e.g. contact since deleted), don't
      // block the response capture; just leave distribution_status unchanged.
      recipients = [];
    }

    const contactsById = new Map(
      context.contacts.map((c) => [
        c.id,
        { lastDistributedAt: c.lastDistributedAt, respondedAt: c.respondedAt },
      ]),
    );
    const tracking = buildTrackingRecords(recipients, contactsById);
    const newStatus = computeDistributionStatus(plan.plan.distributionStatus, tracking);

    if (newStatus !== plan.plan.distributionStatus) {
      await storage.updatePlanDistributionStatus(planId, organizationId, newStatus);
    }

    await logAuditEvent({
      userId: req.user?.id ?? null,
      organizationId: req.user?.organizationId ?? null,
      eventType: "rtw_plan.response_recorded" as any,
      resourceType: "case_contact",
      resourceId: contactId,
      metadata: {
        planId: planId,
        role: updated.role,
        respondedAt: updated.respondedAt?.toISOString() ?? null,
        newDistributionStatus: newStatus,
      },
      ...getRequestMetadata(req),
    });

    return res.json({
      success: true,
      data: {
        contactId,
        respondedAt: updated.respondedAt,
        distributionStatus: newStatus,
      },
    });
  } catch (err) {
    logger.api.error("RTW plan response mark failed", { contactId: req.params.contactId }, err);
    return res.status(500).json({
      error: "Failed to mark response",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/rtw-plans/:planId/approve
 *
 * Finalisation gate: refuses unless distribution_status === 'all_responded'
 * or the practitioner supplies a bypassReason (recorded in the audit log).
 * On approval: rtw_plans.status='approved', distribution_status='finalised'.
 */
router.post("/:planId/approve", async (req: AuthRequest, res) => {
  try {
    const planId = req.params.planId as string;
    const organizationId = req.user!.organizationId;

    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
    }

    // Gate lives inside storage.approveRTWPlan so the Alex agent tool can't
    // bypass it via direct db.update. Route just translates the storage
    // outcome into HTTP shape + writes the audit event.
    const outcome = await storage.approveRTWPlan(planId, organizationId, {
      bypassReason: parsed.data.bypassReason ?? null,
    });
    if (outcome === null) {
      return res.status(404).json({ error: "Plan not found" });
    }
    if (outcome.approved === false) {
      await logAuditEvent({
        userId: req.user?.id ?? null,
        organizationId: req.user?.organizationId ?? null,
        eventType: "rtw_plan.approve_blocked" as any,
        resourceType: "rtw_plan",
        resourceId: planId,
        metadata: { currentDistributionStatus: outcome.currentDistributionStatus },
        ...getRequestMetadata(req),
      });
      return res.status(400).json({
        error:
          "Plan cannot be approved until all gating parties have responded, or a bypass reason is provided.",
        code: "DISTRIBUTION_NOT_COMPLETE",
        currentDistributionStatus: outcome.currentDistributionStatus,
      });
    }

    await logAuditEvent({
      userId: req.user?.id ?? null,
      organizationId: req.user?.organizationId ?? null,
      eventType: "rtw_plan.approved" as any,
      resourceType: "rtw_plan",
      resourceId: planId,
      metadata: {
        bypassReason: outcome.bypassReason,
        priorDistributionStatus: outcome.priorDistributionStatus,
      },
      ...getRequestMetadata(req),
    });

    return res.json({
      success: true,
      data: {
        planId,
        status: "approved",
        distributionStatus: "finalised",
        bypassReason: outcome.bypassReason,
      },
    });
  } catch (err) {
    logger.api.error("RTW plan approve failed", { planId: req.params.planId }, err);
    return res.status(500).json({
      error: "Failed to approve plan",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
