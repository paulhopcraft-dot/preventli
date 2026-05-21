import express, { type Request, type Response, type NextFunction, type Router } from "express";
import multer from "multer";
import { z } from "zod";
import crypto from "crypto";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { sendEmail } from "../services/emailService";
import { jdUpload, saveJdFile } from "../services/fileUpload";
import { checkStorageHealth } from "../services/storageService";
import { createLogger } from "../lib/logger";
import {
  CHECK_CATEGORIES,
  CHECK_LABELS,
  assessmentTypesForCategory,
  type CheckCategory,
} from "@shared/check-categories";

const logger = createLogger("AssessmentsRoutes");
const router: Router = express.Router();

const createAssessmentSchema = z.object({
  candidateName: z.string().min(1),
  candidateEmail: z.string().email(),
  positionTitle: z.string().min(1),
  startDate: z.string().optional(),
  jobDescription: z.string().optional(),
  checkCategory: z.enum(CHECK_CATEGORIES).optional().default("pre_employment"),
});

/**
 * @route POST /api/assessments
 * @desc Create a new pre-employment assessment, upsert worker record
 * @access Private
 *
 * Accepts multipart/form-data so the employer can attach a job description
 * file (PDF/DOC/DOCX) alongside the text fields.
 */
/** Multer error handler — converts file-filter rejections from 500 → 400 */
function uploadJd(req: Request, res: Response, next: NextFunction) {
  jdUpload.single("jobDescriptionFile")(req, res, (err) => {
    if (err instanceof multer.MulterError || err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  });
}

router.post("/", authorize(), uploadJd, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;

    const body = createAssessmentSchema.parse(req.body);

    // Pre-employment requires job description; other types don't
    const hasText = !!(body.jobDescription?.trim());
    const hasFile = !!req.file;
    if (body.checkCategory === "pre_employment" && !hasText && !hasFile) {
      return res.status(400).json({
        error: "Please provide a role description or attach a job description document.",
      });
    }

    // If a file is attached, do a fast preflight check on the storage backend
    // and surface a specific error rather than a generic 500. Common cause of
    // this path failing in prod: AWS_S3_BUCKET / AWS credentials missing on
    // Render. Surfacing the underlying error to the API consumer makes the
    // misconfiguration debuggable from the UI without needing log access.
    let jobDescriptionFileUrl: string | undefined;
    if (hasFile) {
      const health = await checkStorageHealth();
      if (!health.ok) {
        logger.error("Storage health check failed before file upload", {
          provider: health.provider,
          error: health.error,
        });
        return res.status(502).json({
          error: `File storage is misconfigured: ${health.error ?? "unknown"} (provider: ${health.provider}). Set AWS_S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY on the server, or switch STORAGE_PROVIDER=local for dev.`,
        });
      }

      try {
        jobDescriptionFileUrl = (await saveJdFile(req.file!)).url;
      } catch (uploadErr) {
        const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        logger.error("Job description upload failed", {
          provider: health.provider,
          filename: req.file!.originalname,
          mimetype: req.file!.mimetype,
          size: req.file!.size,
        }, uploadErr);
        return res.status(502).json({
          error: `File upload to ${health.provider} storage failed: ${msg}`,
        });
      }
    }

    // Upsert worker record
    const worker = await storage.upsertWorkerByEmail({
      name: body.candidateName,
      email: body.candidateEmail,
      organizationId,
    });

    // Generate unique access token
    const accessToken = crypto.randomBytes(32).toString("hex");

    // Map check category to assessmentType stored in DB
    const assessmentType = body.checkCategory === "pre_employment" ? "baseline_health" : body.checkCategory;

    // Create assessment record
    const assessment = await storage.createPreEmploymentAssessment({
      organizationId,
      workerId: worker.id,
      candidateName: body.candidateName,
      candidateEmail: body.candidateEmail,
      positionTitle: body.positionTitle,
      assessmentType,
      status: "created",
      accessToken,
      jobDescription: body.jobDescription,
      jobDescriptionFileUrl,
      createdBy: userId,
    } as Parameters<typeof storage.createPreEmploymentAssessment>[0]);

    logger.info("Assessment created", { assessmentId: assessment.id, workerId: worker.id });
    res.status(201).json({ assessment, worker });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    logger.error("Error creating assessment:", undefined, error);
    res.status(500).json({ error: "Failed to create assessment" });
  }
});

/**
 * @route POST /api/assessments/:id/send
 * @desc Email the questionnaire link to the worker
 * @access Private
 */
router.post("/:id/send", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;

    const assessment = await storage.getPreEmploymentAssessmentById(id, organizationId);
    if (!assessment) {
      return res.status(404).json({ error: "Assessment not found" });
    }
    if (!assessment.accessToken) {
      return res.status(400).json({ error: "Assessment has no access token" });
    }
    if (!assessment.candidateEmail) {
      return res.status(400).json({ error: "Assessment has no candidate email" });
    }

    // Fallback to the live production URL — never embed a localhost link in an
    // email that gets posted to a real recipient. If running against a non-prod
    // environment, set APP_URL explicitly in .env (e.g. http://localhost:5000).
    const appUrl = process.env.APP_URL ?? "https://gpnet3.onrender.com";
    const link = `${appUrl}/check/${assessment.accessToken}`;

    const checkLabel = CHECK_LABELS[(assessment.assessmentType as CheckCategory) ?? "pre_employment"]
      ?? CHECK_LABELS.pre_employment;

    const emailResult = await sendEmail({
      to: assessment.candidateEmail,
      subject: `${checkLabel} — ${assessment.positionTitle}`,
      body: `Hi ${assessment.candidateName},

Please complete your ${checkLabel.toLowerCase()} using the secure link below:

${link}

This link is personal to you. Please do not share it.

If you have any questions, please contact us.

— Preventli Health Team`,
    });

    if (!emailResult.success) {
      logger.error("Email delivery failed", undefined, { assessmentId: id, error: emailResult.error });
      return res.status(502).json({
        error: emailResult.error
          ? `Email send failed: ${emailResult.error}. Set RESEND_API_KEY (or fix SMTP_* env vars) on Render.`
          : "Failed to deliver email — no provider configured. Set RESEND_API_KEY on Render.",
      });
    }

    await storage.updatePreEmploymentAssessmentStatus(id, organizationId, {
      status: "sent",
      sentAt: new Date(),
    });

    logger.info("Questionnaire link sent", { assessmentId: id, to: assessment.candidateEmail });
    res.json({ success: true, sentTo: assessment.candidateEmail });
  } catch (error) {
    logger.error("Error sending assessment:", undefined, error);
    res.status(500).json({ error: "Failed to send assessment" });
  }
});

/**
 * @route GET /api/assessments
 * @desc List assessments for the organization, optionally filtered by check
 *       category via `?category=`. Absent category → all assessments
 *       (backward compatible); invalid category → 400.
 * @access Private
 */
router.get("/", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    // Optional ?category= filter. Validate against the known categories so a
    // bad value is a clear 400, not a silent unfiltered fallback.
    let category: CheckCategory | undefined;
    if (req.query.category !== undefined) {
      const parsed = z.enum(CHECK_CATEGORIES).safeParse(req.query.category);
      if (!parsed.success) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${CHECK_CATEGORIES.join(", ")}`,
        });
      }
      category = parsed.data;
    }

    const all = await storage.getPreEmploymentAssessments(organizationId);
    // When a category is requested, keep only assessments whose stored
    // assessmentType belongs to that category.
    const filtered = category
      ? all.filter(a => assessmentTypesForCategory(category!).includes(a.assessmentType))
      : all;
    // Return only the fields the UI needs (exclude sensitive internals like accessToken)
    const assessments = filtered.map(a => ({
      id: a.id,
      workerId: a.workerId,
      candidateName: a.candidateName,
      positionTitle: a.positionTitle,
      assessmentType: a.assessmentType,
      status: a.status,
      clearanceLevel: a.clearanceLevel,
      sentAt: a.sentAt,
      createdAt: a.createdAt,
      reportJson: a.reportJson,
    }));
    res.json({ assessments });
  } catch (error) {
    logger.error("Error listing assessments:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve assessments" });
  }
});

/**
 * @route GET /api/assessments/:id
 * @desc Get single assessment
 * @access Private
 */
router.get("/:id", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;
    const assessment = await storage.getPreEmploymentAssessmentById(id, organizationId);
    if (!assessment) return res.status(404).json({ error: "Not found" });
    res.json({ assessment });
  } catch (error) {
    logger.error("Error getting assessment:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve assessment" });
  }
});

export default router;
