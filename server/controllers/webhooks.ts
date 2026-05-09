import { Response } from "express";
import type { WebhookRequest } from "../webhookSecurity";
import type { AuthRequest } from "../middleware/auth";
import { db } from "../db";
import { webhookFormMappings, workerCases, type RestrictionItem, type CaseClinicalStatus } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { logger } from "../lib/logger";

/**
 * Handle JotForm webhook submission
 * POST /api/webhooks/jotform
 *
 * organizationId is extracted from form mapping (NOT from user input)
 * This prevents users from submitting forms to other organizations
 */
export async function handleJotFormWebhook(req: WebhookRequest, res: Response) {
  try {
    // Webhook security middleware has already verified:
    // 1. Form ID exists
    // 2. Password is valid
    // 3. Form mapping is active
    // 4. organizationId is attached to req.webhookFormMapping

    if (!req.webhookFormMapping) {
      // This should never happen if middleware is properly configured
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Webhook form mapping not found in request",
      });
    }

    const { organizationId, formType } = req.webhookFormMapping;
    const formData = req.body;

    logger.webhook.info("Processing JotForm webhook", {
      formId: req.webhookFormMapping.formId,
      organizationId,
      formType,
      submissionId: formData.submissionID,
    });

    // Process based on form type
    switch (formType) {
      case "worker_injury":
        await handleWorkerInjuryForm(formData, organizationId);
        break;

      case "medical_certificate":
        await handleMedicalCertificateForm(formData, organizationId);
        break;

      case "return_to_work":
        await handleReturnToWorkForm(formData, organizationId);
        break;

      default:
        logger.webhook.warn("Unknown form type", { formType });
        return res.status(400).json({
          error: "Bad Request",
          message: `Unsupported form type: ${formType}`,
        });
    }

    res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      data: {
        submissionId: formData.submissionID,
        organizationId, // Confirm which org it was processed for
        formType,
      },
    });
  } catch (error) {
    logger.webhook.error("JotForm webhook processing error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to process webhook",
    });
  }
}

/**
 * Process worker injury report form
 */
async function handleWorkerInjuryForm(formData: any, organizationId: string) {
  // Extract fields from JotForm submission
  // Field IDs would be configured per form
  const workerName = formData.q3_workerName || formData.worker_name;
  const company = formData.q4_company || formData.company;
  const dateOfInjury = formData.q5_dateOfInjury || formData.date_of_injury;
  const injuryType = formData.q6_injuryType || formData.injury_type;
  const injuryDescription = formData.q7_description || formData.description;

  // Build summary from injury type and description
  const summaryParts = [];
  if (injuryType) summaryParts.push(`Injury Type: ${injuryType}`);
  if (injuryDescription) summaryParts.push(injuryDescription);
  const summary = summaryParts.length > 0 ? summaryParts.join(". ") : "New injury report submitted via JotForm";

  const resolvedWorkerName: string = workerName || "Unknown Worker";
  const { storage } = await import("../storage");
  const resolvedWorkerId = await storage.resolveOrCreateWorker(
    resolvedWorkerName,
    organizationId,
  );

  // Create worker case with organizationId from mapping (NOT from form data)
  await db.insert(workerCases).values({
    id: `CASE-${Date.now()}-${randomBytes(4).toString("hex")}`,
    organizationId,
    workerId: resolvedWorkerId,
    workerName: resolvedWorkerName,
    company: company || "Unknown Company",
    dateOfInjury: dateOfInjury ? new Date(dateOfInjury) : new Date(),
    riskLevel: "medium",
    workStatus: "unknown",
    complianceIndicator: "yellow",
    currentStatus: "Pending Review",
    nextStep: "Review injury report and assign case manager",
    owner: "Unassigned",
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 7 days from now
    summary,
  });

  logger.webhook.info("Worker injury case created", {
    workerName,
    organizationId,
    submissionId: formData.submissionID,
  });
}

/**
 * Process medical certificate upload form
 *
 * Expected form fields (JotForm field IDs):
 * - q3_workerName / worker_name: Worker's name
 * - q4_caseId / case_id: Case ID (optional, will fuzzy match by worker name if not provided)
 * - q5_issueDate / issue_date: Certificate issue date
 * - q6_startDate / start_date: Period start date
 * - q7_endDate / end_date: Period end date
 * - q8_capacity / capacity: Work capacity (full/modified/none)
 * - q9_practitioner / practitioner: Treating practitioner name
 * - q10_restrictions / restrictions: Work restrictions (JSON array or comma-separated)
 * - q11_notes / notes: Additional notes
 * - q12_documentUrl / document_url: URL to certificate document
 */
async function handleMedicalCertificateForm(formData: any, organizationId: string) {
  logger.webhook.info("Processing medical certificate form", {
    organizationId,
    submissionId: formData.submissionID,
  });

  // Extract fields from JotForm submission
  const workerName = formData.q3_workerName || formData.worker_name;
  let caseId = formData.q4_caseId || formData.case_id;
  const issueDate = formData.q5_issueDate || formData.issue_date;
  const startDate = formData.q6_startDate || formData.start_date;
  const endDate = formData.q7_endDate || formData.end_date;
  const capacity = formData.q8_capacity || formData.capacity || "modified";
  const practitioner = formData.q9_practitioner || formData.practitioner;
  const restrictionsRaw = formData.q10_restrictions || formData.restrictions;
  const notes = formData.q11_notes || formData.notes;
  const documentUrl = formData.q12_documentUrl || formData.document_url;

  // Validate required fields
  if (!workerName && !caseId) {
    throw new Error("Medical certificate form requires either worker_name or case_id");
  }

  if (!startDate || !endDate) {
    throw new Error("Medical certificate form requires start_date and end_date");
  }

  // If no case ID provided, try to find case by worker name
  if (!caseId && workerName) {
    const { storage } = await import("../storage");
    const match = await storage.findCaseByWorkerName(workerName);
    if (match && match.confidence >= 0.7) {
      caseId = match.caseId;
      logger.webhook.info("Matched worker to case by name", {
        workerName,
        matchedCaseId: caseId,
        confidence: match.confidence,
      });
    } else {
      throw new Error(`Could not find case for worker: ${workerName}`);
    }
  }

  // Parse restrictions (handle JSON array or comma-separated string)
  // RestrictionItem type: { type, description, startDate?, endDate? }
  let restrictions: RestrictionItem[] = [];
  if (restrictionsRaw) {
    try {
      if (typeof restrictionsRaw === "string") {
        // Try JSON parse first
        const parsed = JSON.parse(restrictionsRaw);
        if (Array.isArray(parsed)) {
          restrictions = parsed.map((r: any) => ({
            type: r.type || "other",
            description: r.description || String(r),
            startDate: r.startDate,
            endDate: r.endDate,
          }));
        } else {
          restrictions = [{ type: "other", description: String(parsed) }];
        }
      } else if (Array.isArray(restrictionsRaw)) {
        restrictions = restrictionsRaw.map((r: any) =>
          typeof r === "string"
            ? { type: "other" as const, description: r }
            : { type: r.type || "other", description: r.description || String(r), startDate: r.startDate, endDate: r.endDate }
        );
      }
    } catch {
      // Fallback: treat as comma-separated string
      restrictions = restrictionsRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((desc: string): RestrictionItem => ({ type: "other", description: desc }));
    }
  }

  // Create medical certificate
  const { storage } = await import("../storage");
  const certificate = await storage.createCertificate({
    caseId,
    issueDate: issueDate ? new Date(issueDate) : new Date(),
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    capacity,
    notes,
    source: "jotform_webhook",
    documentUrl,
    sourceReference: formData.submissionID,
    certificateType: "medical_certificate",
    organizationId,
    treatingPractitioner: practitioner,
    restrictions,
  });

  logger.webhook.info("Medical certificate created from webhook", {
    certificateId: certificate.id,
    caseId,
    organizationId,
    submissionId: formData.submissionID,
  });
}

/**
 * Process return to work plan form
 *
 * Expected form fields (JotForm field IDs):
 * - q3_workerName / worker_name: Worker's name
 * - q4_caseId / case_id: Case ID (optional, will fuzzy match by worker name if not provided)
 * - q5_rtwPlanStatus / rtw_plan_status: Plan status (not_planned/planned_not_started/in_progress/working_well/failing)
 * - q6_startDate / start_date: RTW plan start date
 * - q7_targetFullCapacityDate / target_full_capacity_date: Target date for full capacity
 * - q8_currentCapacity / current_capacity: Current work capacity level
 * - q9_hoursPerWeek / hours_per_week: Current hours per week
 * - q10_duties / duties: Current duties (JSON array or comma-separated)
 * - q11_restrictions / restrictions: Current restrictions
 * - q12_progressNotes / progress_notes: Progress notes
 * - q13_blockers / blockers: Current blockers to RTW
 */
async function handleReturnToWorkForm(formData: any, organizationId: string) {
  logger.webhook.info("Processing return to work form", {
    organizationId,
    submissionId: formData.submissionID,
  });

  // Extract fields from JotForm submission
  const workerName = formData.q3_workerName || formData.worker_name;
  let caseId = formData.q4_caseId || formData.case_id;
  const rtwPlanStatus = formData.q5_rtwPlanStatus || formData.rtw_plan_status || "in_progress";
  const startDate = formData.q6_startDate || formData.start_date;
  const targetFullCapacityDate = formData.q7_targetFullCapacityDate || formData.target_full_capacity_date;
  const currentCapacity = formData.q8_currentCapacity || formData.current_capacity;
  const hoursPerWeek = formData.q9_hoursPerWeek || formData.hours_per_week;
  const dutiesRaw = formData.q10_duties || formData.duties;
  const restrictions = formData.q11_restrictions || formData.restrictions;
  const progressNotes = formData.q12_progressNotes || formData.progress_notes;
  const blockers = formData.q13_blockers || formData.blockers;

  // Validate required fields
  if (!workerName && !caseId) {
    throw new Error("Return to work form requires either worker_name or case_id");
  }

  // If no case ID provided, try to find case by worker name
  if (!caseId && workerName) {
    const { storage } = await import("../storage");
    const match = await storage.findCaseByWorkerName(workerName);
    if (match && match.confidence >= 0.7) {
      caseId = match.caseId;
      logger.webhook.info("Matched worker to case by name", {
        workerName,
        matchedCaseId: caseId,
        confidence: match.confidence,
      });
    } else {
      throw new Error(`Could not find case for worker: ${workerName}`);
    }
  }

  // Validate RTW plan status
  const validStatuses = ["not_planned", "planned_not_started", "in_progress", "working_well", "failing"];
  if (!validStatuses.includes(rtwPlanStatus)) {
    throw new Error(`Invalid RTW plan status: ${rtwPlanStatus}. Must be one of: ${validStatuses.join(", ")}`);
  }

  // Parse duties (handle JSON array or comma-separated string)
  let duties: string[] = [];
  if (dutiesRaw) {
    try {
      if (typeof dutiesRaw === "string") {
        const parsed = JSON.parse(dutiesRaw);
        duties = Array.isArray(parsed) ? parsed : [String(parsed)];
      } else if (Array.isArray(dutiesRaw)) {
        duties = dutiesRaw.map((d: any) => String(d));
      }
    } catch {
      // Fallback: treat as comma-separated string
      duties = dutiesRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
  }

  // Build clinical status update
  const { storage } = await import("../storage");

  // Build functional capacity object
  const functionalCapacity: any = {};
  if (currentCapacity) {
    functionalCapacity.currentCapacityLevel = currentCapacity;
  }
  if (hoursPerWeek) {
    functionalCapacity.hoursPerWeek = Number(hoursPerWeek) || undefined;
  }
  if (duties.length > 0) {
    functionalCapacity.currentDuties = duties;
  }
  if (restrictions) {
    functionalCapacity.restrictions = restrictions;
  }
  if (targetFullCapacityDate) {
    functionalCapacity.estimatedReturnToFullCapacity = targetFullCapacityDate;
  }

  // Update case clinical status with RTW plan info
  const clinicalStatusUpdate: Partial<CaseClinicalStatus> = {
    rtwPlanStatus: rtwPlanStatus as CaseClinicalStatus["rtwPlanStatus"],
  };

  // Only add functionalCapacity if we have data
  if (Object.keys(functionalCapacity).length > 0) {
    clinicalStatusUpdate.functionalCapacity = functionalCapacity;
  }

  await storage.updateClinicalStatus(caseId, organizationId, clinicalStatusUpdate);

  logger.webhook.info("RTW plan updated from webhook", {
    caseId,
    organizationId,
    rtwPlanStatus,
    submissionId: formData.submissionID,
  });

  // If RTW plan is failing, this might warrant a notification or action
  if (rtwPlanStatus === "failing" && blockers) {
    logger.webhook.warn("RTW plan failing for case", {
      caseId,
      blockers,
      progressNotes,
    });
    // Future enhancement: Create notification or action item for failing RTW plans
  }
}

/**
 * Admin endpoint: Register a new form for webhook processing
 * POST /api/admin/webhook-forms
 */
export async function registerWebhookForm(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only administrators can register webhook forms",
      });
    }

    const { formId, organizationId, formType, webhookPassword } = req.body;

    // Validate required fields
    if (!formId || !organizationId || !formType || !webhookPassword) {
      return res.status(400).json({
        error: "Bad Request",
        message: "formId, organizationId, formType, and webhookPassword are required",
      });
    }

    // Validate form type
    const validFormTypes = ["worker_injury", "medical_certificate", "return_to_work"];
    if (!validFormTypes.includes(formType)) {
      return res.status(400).json({
        error: "Bad Request",
        message: `formType must be one of: ${validFormTypes.join(", ")}`,
      });
    }

    // Check if form already registered
    const existing = await db
      .select()
      .from(webhookFormMappings)
      .where(eq(webhookFormMappings.formId, formId))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({
        error: "Conflict",
        message: "Form ID already registered",
      });
    }

    // Register form mapping
    const [mapping] = await db
      .insert(webhookFormMappings)
      .values({
        formId,
        organizationId,
        formType,
        webhookPassword,
        isActive: true,
      })
      .returning();

    res.status(201).json({
      success: true,
      message: "Webhook form registered successfully",
      data: {
        mapping: {
          id: mapping.id,
          formId: mapping.formId,
          organizationId: mapping.organizationId,
          formType: mapping.formType,
          isActive: mapping.isActive,
          createdAt: mapping.createdAt,
          // Include password in response for initial setup
          // Admin needs this to configure JotForm webhook
          webhookPassword: mapping.webhookPassword,
          webhookUrl: `${process.env.API_URL || 'http://localhost:5000'}/api/webhooks/jotform`,
        },
      },
    });
  } catch (error) {
    logger.webhook.error("Register webhook form error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to register webhook form",
    });
  }
}

/**
 * Admin endpoint: List all webhook form mappings
 * GET /api/admin/webhook-forms?organizationId=xxx
 */
export async function listWebhookForms(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only administrators can view webhook forms",
      });
    }

    const { organizationId } = req.query;

    let mappings;
    if (organizationId) {
      mappings = await db
        .select()
        .from(webhookFormMappings)
        .where(eq(webhookFormMappings.organizationId, organizationId as string));
    } else {
      mappings = await db.select().from(webhookFormMappings);
    }

    res.json({
      success: true,
      data: {
        mappings: mappings.map((m) => ({
          id: m.id,
          formId: m.formId,
          organizationId: m.organizationId,
          formType: m.formType,
          isActive: m.isActive,
          createdAt: m.createdAt,
          // Don't expose password in list view
        })),
        total: mappings.length,
      },
    });
  } catch (error) {
    logger.webhook.error("List webhook forms error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to list webhook forms",
    });
  }
}

/**
 * Admin endpoint: Deactivate a webhook form mapping
 * DELETE /api/admin/webhook-forms/:id
 */
export async function deactivateWebhookForm(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only administrators can deactivate webhook forms",
      });
    }

    const { id } = req.params;

    const [updated] = await db
      .update(webhookFormMappings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(webhookFormMappings.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({
        error: "Not Found",
        message: "Webhook form mapping not found",
      });
    }

    res.json({
      success: true,
      message: "Webhook form deactivated successfully",
      data: {
        mapping: {
          id: updated.id,
          formId: updated.formId,
          isActive: updated.isActive,
        },
      },
    });
  } catch (error) {
    logger.webhook.error("Deactivate webhook form error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to deactivate webhook form",
    });
  }
}
