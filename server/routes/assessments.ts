import express, { type Request, type Response, type NextFunction, type Router } from "express";
import multer from "multer";
import { z } from "zod";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { sendEmail } from "../services/emailService";
import { jdUpload, saveJdFile } from "../services/fileUpload";
import { createLogger } from "../lib/logger";

const logger = createLogger("AssessmentsRoutes");
const router: Router = express.Router();

const CHECK_CATEGORIES = ["pre_employment", "exit", "wellness", "mental_health", "prevention", "injury"] as const;
type CheckCategory = typeof CHECK_CATEGORIES[number];

const CHECK_LABELS: Record<CheckCategory, string> = {
  pre_employment: "Pre-Employment Health Check",
  exit: "Exit Health Check",
  wellness: "General Wellness Assessment",
  mental_health: "Mental Health Assessment",
  prevention: "Prevention & Safety Check",
  injury: "Injury Assessment",
};

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

    const jobDescriptionFileUrl = hasFile ? (await saveJdFile(req.file!)).url : undefined;

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

    // Look up the client org name so the email tells the candidate which
    // company the check is for, instead of a generic "Preventli" sign-off.
    // For partner-tier flows, organizationId is the client's id (e.g. Alpine
    // Health) because partner JWT-swap puts it on the assessment record.
    let orgName: string | null = null;
    if (assessment.organizationId) {
      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, assessment.organizationId))
        .limit(1);
      orgName = org?.name ?? null;
    }

    const sender = orgName ?? "Preventli Health";
    const subject = orgName
      ? `${orgName} — ${checkLabel} for ${assessment.positionTitle}`
      : `${checkLabel} — ${assessment.positionTitle}`;
    const intro = orgName
      ? `${orgName} has invited you to complete a ${checkLabel.toLowerCase()} as part of your application for the ${assessment.positionTitle} role.`
      : `Please complete your ${checkLabel.toLowerCase()} for the ${assessment.positionTitle} role.`;

    const emailResult = await sendEmail({
      to: assessment.candidateEmail,
      subject,
      body: `Hi ${assessment.candidateName},

${intro}

Use the secure link below to complete your check:

${link}

This link is personal to you. Please do not share it.

If you have any questions, please contact ${sender}.

— The ${sender} team`,
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
 * @desc List assessments for the organization
 * @access Private
 */
router.get("/", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const all = await storage.getPreEmploymentAssessments(organizationId);
    // Return only the fields the UI needs (exclude sensitive internals like accessToken)
    const assessments = all.map(a => ({
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
