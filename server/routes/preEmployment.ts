import crypto from "crypto";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { logAuditEvent, AuditEventTypes, getRequestMetadata } from "../services/auditLogger";
import {
  insertPreEmploymentAssessmentSchema,
  insertPreEmploymentHealthRequirementSchema,
  insertPreEmploymentAssessmentComponentSchema,
  insertPreEmploymentHealthHistorySchema,
  type PreEmploymentAssessmentDB,
  type PreEmploymentHealthRequirementDB,
  type PreEmploymentAssessmentStatus,
  type PreEmploymentClearanceLevel
} from "@shared/schema";
import { createLogger } from "../lib/logger";

const logger = createLogger("PreEmploymentRoutes");
const router: Router = express.Router();

// =============================================================================
// Pre-Employment Health Requirements Management
// =============================================================================

/**
 * @route GET /api/pre-employment/requirements
 * @desc Get all health requirements for the organization
 * @access Private (requires auth)
 */
router.get("/requirements", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const requirements = await storage.getPreEmploymentHealthRequirements(organizationId);

    logger.info(`Retrieved ${requirements.length} pre-employment health requirements`, {
      organizationId,
      userId: req.user!.id
    });

    res.json({ requirements });
  } catch (error) {
    logger.error("Error getting pre-employment health requirements:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve health requirements" });
  }
});

/**
 * @route POST /api/pre-employment/requirements
 * @desc Create new health requirement for a position
 * @access Private (requires auth)
 */
router.post("/requirements", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;

    const validatedData = insertPreEmploymentHealthRequirementSchema.parse({
      ...req.body,
      organizationId,
      createdBy: userId
    });

    const requirement = await storage.createPreEmploymentHealthRequirement(validatedData as any);

    const requestMeta = getRequestMetadata(req);
    await logAuditEvent({
      organizationId,
      userId,
      eventType: AuditEventTypes.CASE_UPDATE,
      resourceType: "pre_employment_requirement",
      resourceId: requirement.id,
      metadata: {
        action: "created",
        positionTitle: requirement.positionTitle,
        roleId: requirement.roleId
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent
    });

    logger.info(`Created pre-employment health requirement for position: ${requirement.positionTitle}`, {
      requirementId: requirement.id,
      organizationId,
      userId
    });

    res.status(201).json({ requirement });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    logger.error("Error creating pre-employment health requirement:", undefined, error);
    res.status(500).json({ error: "Failed to create health requirement" });
  }
});

/**
 * @route PUT /api/pre-employment/requirements/:id
 * @desc Update health requirement
 * @access Private (requires auth)
 */
router.put("/requirements/:id", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;
    const requirementId = req.params.id as string;

    const validatedData = insertPreEmploymentHealthRequirementSchema.partial().parse(req.body);

    const requirement = await storage.updatePreEmploymentHealthRequirement(
      requirementId,
      organizationId,
      validatedData
    );

    if (!requirement) {
      return res.status(404).json({ error: "Health requirement not found" });
    }

    const requestMeta = getRequestMetadata(req);
    await logAuditEvent({
      organizationId,
      userId,
      eventType: AuditEventTypes.CASE_UPDATE,
      resourceType: "pre_employment_requirement",
      resourceId: requirement.id,
      metadata: {
        action: "updated",
        positionTitle: requirement.positionTitle
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent
    });

    logger.info(`Updated pre-employment health requirement: ${requirementId}`, {
      requirementId,
      organizationId,
      userId
    });

    res.json({ requirement });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    logger.error("Error updating pre-employment health requirement:", undefined, error);
    res.status(500).json({ error: "Failed to update health requirement" });
  }
});

// =============================================================================
// Pre-Employment Health Assessments
// =============================================================================

/**
 * @route GET /api/pre-employment/assessments
 * @desc Get all assessments for the organization
 * @access Private (requires auth)
 */
router.get("/assessments", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { status, assessmentType, limit, offset } = req.query;

    const filters = {
      status: status as PreEmploymentAssessmentStatus | undefined,
      assessmentType: assessmentType as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    };

    const assessments = await storage.getPreEmploymentAssessments(organizationId, filters);

    logger.info(`Retrieved ${assessments.length} pre-employment assessments`, {
      organizationId,
      userId: req.user!.id,
      filters
    });

    res.json({ assessments });
  } catch (error) {
    logger.error("Error getting pre-employment assessments:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve assessments" });
  }
});

/**
 * @route POST /api/pre-employment/assessments
 * @desc Create new pre-employment assessment
 * @access Private (requires auth)
 */
router.post("/assessments", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;

    const assessmentData = {
      ...req.body,
      organizationId,
      createdBy: userId,
      // BUG-002 fix: generate access token so worker-facing /check/{token} link can be built
      accessToken: crypto.randomBytes(32).toString('hex'),
      // Set completedDate as Date object when status is completed
      ...(req.body.status === 'completed' ? { completedDate: new Date() } : {}),
      ...(req.body.scheduledDate ? { scheduledDate: new Date(req.body.scheduledDate) } : {}),
    };

    const assessment = await storage.createPreEmploymentAssessment(assessmentData as any);

    const requestMeta = getRequestMetadata(req);
    await logAuditEvent({
      organizationId,
      userId,
      eventType: AuditEventTypes.CASE_UPDATE,
      resourceType: "pre_employment_assessment",
      resourceId: assessment.id,
      metadata: {
        action: "created",
        candidateName: assessment.candidateName,
        positionTitle: assessment.positionTitle,
        assessmentType: assessment.assessmentType
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent
    });

    logger.info(`Created pre-employment assessment for candidate: ${assessment.candidateName}`, {
      assessmentId: assessment.id,
      organizationId,
      userId
    });

    res.status(201).json({ assessment });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    logger.error("Error creating pre-employment assessment:", undefined, error);
    res.status(500).json({ error: "Failed to create assessment" });
  }
});

/**
 * @route GET /api/pre-employment/assessments/:id
 * @desc Get specific assessment with full details
 * @access Private (requires auth)
 */
router.get("/assessments/:id", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const assessmentId = req.params.id as string;

    const assessment = await storage.getPreEmploymentAssessmentById(assessmentId, organizationId);

    if (!assessment) {
      return res.status(404).json({ error: "Assessment not found" });
    }

    // Get assessment components and health history
    const components = await storage.getPreEmploymentAssessmentComponents(assessmentId);
    const healthHistory = await storage.getPreEmploymentHealthHistory(assessmentId);

    const fullAssessment = {
      ...assessment,
      components,
      healthHistory
    };

    logger.info(`Retrieved pre-employment assessment: ${assessmentId}`, {
      assessmentId,
      organizationId,
      userId: req.user!.id
    });

    res.json({ assessment: fullAssessment });
  } catch (error) {
    logger.error("Error getting pre-employment assessment:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve assessment" });
  }
});

/**
 * @route PUT /api/pre-employment/assessments/:id/status
 * @desc Update assessment status and clearance level
 * @access Private (requires auth)
 */
router.put("/assessments/:id/status", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;
    const assessmentId = req.params.id as string;

    const updateSchema = z.object({
      status: z.enum(["pending", "scheduled", "in_progress", "completed", "failed", "cancelled"]),
      clearanceLevel: z.enum(["cleared_unconditional", "cleared_conditional", "cleared_with_restrictions", "not_cleared", "pending_review"]).optional(),
      completedDate: z.string().datetime().optional(),
      notes: z.string().optional()
    });

    const validatedData = updateSchema.parse(req.body);

    // BUG-001 fix: enforce state-machine transitions — no jumping to arbitrary statuses
    const VALID_TRANSITIONS: Record<string, string[]> = {
      pending:     ['scheduled', 'cancelled'],
      scheduled:   ['in_progress', 'cancelled'],
      in_progress: ['completed', 'failed', 'cancelled'],
      completed:   [],
      failed:      ['pending'],
      cancelled:   [],
    };

    const current = await storage.getPreEmploymentAssessmentById(assessmentId, organizationId);
    if (!current) {
      return res.status(404).json({ error: "Assessment not found" });
    }
    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(validatedData.status)) {
      return res.status(422).json({
        error: `Invalid status transition`,
        detail: `Cannot move assessment from '${current.status}' to '${validatedData.status}'. Allowed: [${allowed.join(', ') || 'none'}]`,
      });
    }

    const assessment = await storage.updatePreEmploymentAssessmentStatus(
      assessmentId,
      organizationId,
      validatedData as any
    );

    if (!assessment) {
      return res.status(404).json({ error: "Assessment not found" });
    }

    const requestMeta = getRequestMetadata(req);
    await logAuditEvent({
      organizationId,
      userId,
      eventType: AuditEventTypes.CASE_UPDATE,
      resourceType: "pre_employment_assessment",
      resourceId: assessment.id,
      metadata: {
        action: "status_updated",
        candidateName: assessment.candidateName,
        newStatus: validatedData.status,
        clearanceLevel: validatedData.clearanceLevel
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent
    });

    logger.info(`Updated assessment status for candidate: ${assessment.candidateName}`, {
      assessmentId,
      status: validatedData.status,
      clearanceLevel: validatedData.clearanceLevel,
      organizationId,
      userId
    });

    res.json({ assessment });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    logger.error("Error updating assessment status:", undefined, error);
    res.status(500).json({ error: "Failed to update assessment status" });
  }
});

// =============================================================================
// Assessment Components
// =============================================================================

/**
 * @route POST /api/pre-employment/assessments/:id/components
 * @desc Add assessment component (test result)
 * @access Private (requires auth)
 */
router.post("/assessments/:id/components", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;
    const assessmentId = req.params.id as string;

    // Verify assessment exists and belongs to organization
    const assessment = await storage.getPreEmploymentAssessmentById(assessmentId, organizationId);
    if (!assessment) {
      return res.status(404).json({ error: "Assessment not found" });
    }

    const componentData = {
      ...req.body,
      assessmentId
    };

    const component = await storage.createPreEmploymentAssessmentComponent(componentData as any);

    const requestMeta = getRequestMetadata(req);
    await logAuditEvent({
      organizationId,
      userId,
      eventType: AuditEventTypes.CASE_UPDATE,
      resourceType: "pre_employment_assessment_component",
      resourceId: component.id,
      metadata: {
        action: "created",
        assessmentId,
        componentType: component.componentType,
        result: component.result
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent
    });

    logger.info(`Added assessment component: ${component.componentType}`, {
      componentId: component.id,
      assessmentId,
      organizationId,
      userId
    });

    res.status(201).json({ component });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    logger.error("Error creating assessment component:", undefined, error);
    res.status(500).json({ error: "Failed to add assessment component" });
  }
});

// =============================================================================
// Dashboard and Summary Endpoints
// =============================================================================

/**
 * @route GET /api/pre-employment/dashboard
 * @desc Get pre-employment dashboard statistics
 * @access Private (requires auth)
 */
router.get("/dashboard", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const stats = await storage.getPreEmploymentDashboardStats(organizationId);

    logger.info("Retrieved pre-employment dashboard stats", {
      organizationId,
      userId: req.user!.id,
      stats
    });

    res.json({ stats });
  } catch (error) {
    logger.error("Error getting pre-employment dashboard stats:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve dashboard statistics" });
  }
});

export default router;