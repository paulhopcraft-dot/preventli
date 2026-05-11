/**
 * Email Drafts API Routes
 *
 * Endpoints for AI-powered email drafting.
 */

import express, { Request, Response } from "express";
import { z } from "zod";
import { authorize, type AuthRequest } from "../middleware/auth";
import { requireCaseOwnership } from "../middleware/caseOwnership";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import {
  generateEmailDraft,
  getEmailDraftsByCase,
  getEmailDraftById,
  updateEmailDraft,
  deleteEmailDraft,
  getEmailTypes,
} from "../services/emailDraftService";
import { sendEmail } from "../services/emailService";

const router = express.Router();

// Zod schemas for validation
const generateSchema = z.object({
  emailType: z.enum([
    "initial_contact",
    "certificate_chase",
    "check_in_follow_up",
    "rtw_update",
    "duties_proposal",
    "non_compliance_warning",
    "employer_update",
    "insurer_report",
    "general_response",
  ]),
  recipient: z.enum(["worker", "employer", "insurer", "host", "other"]),
  recipientName: z.string().max(200).optional(),
  recipientEmail: z.string().email().optional(),
  additionalContext: z.string().max(1000).optional(),
  tone: z.enum(["formal", "supportive", "firm"]).optional(),
});

const updateSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).optional(),
  status: z.enum(["draft", "sent", "discarded"]).optional(),
  recipientName: z.string().max(200).optional(),
  recipientEmail: z.string().email().optional(),
});

/**
 * GET /api/email-drafts/types
 * List available email types for UI dropdown
 */
router.get("/email-drafts/types", authorize(), async (_req: Request, res: Response) => {
  try {
    const types = getEmailTypes();
    res.json({
      success: true,
      data: types,
    });
  } catch (error: any) {
    logger.api.error("Failed to get email types", {}, error);
    res.status(500).json({
      success: false,
      error: "Failed to get email types",
      message: error.message,
    });
  }
});

/**
 * POST /api/cases/:caseId/email-drafts/generate
 * Generate a new email draft using AI
 */
router.post(
  "/cases/:caseId/email-drafts/generate",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware
      const userId = req.user?.id || "unknown";

      // Validate request body
      const parseResult = generateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: "Invalid request body",
          details: parseResult.error.errors,
        });
      }

      const draft = await generateEmailDraft(storage, workerCase.id, workerCase.organizationId, parseResult.data as any, userId);

      res.json({
        success: true,
        data: draft,
      });
    } catch (error: any) {
      logger.api.error("Email draft generation failed", {}, error);

      res.status(500).json({
        success: false,
        error: "Failed to generate email draft",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/cases/:caseId/email-drafts
 * List all email drafts for a case
 */
router.get(
  "/cases/:caseId/email-drafts",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      const drafts = await getEmailDraftsByCase(storage, workerCase.id, workerCase.organizationId);

      res.json({
        success: true,
        data: drafts,
      });
    } catch (error: any) {
      logger.api.error("Failed to get email drafts", {}, error);
      res.status(500).json({
        success: false,
        error: "Failed to get email drafts",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/cases/:caseId/email-drafts/:draftId
 * Get a single email draft
 * SECURITY: requireCaseOwnership validates user can access this case
 */
router.get(
  "/cases/:caseId/email-drafts/:draftId",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const draftId = req.params.draftId as string;
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      const draft = await getEmailDraftById(storage, draftId);
      if (!draft || draft.caseId !== workerCase.id) {
        return res.status(404).json({
          success: false,
          error: "Email draft not found",
        });
      }

      res.json({
        success: true,
        data: draft,
      });
    } catch (error: any) {
      logger.api.error("Failed to get email draft", {}, error);
      res.status(500).json({
        success: false,
        error: "Failed to get email draft",
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /api/cases/:caseId/email-drafts/:draftId
 * Update an email draft
 * SECURITY: requireCaseOwnership validates user can access this case
 */
router.patch(
  "/cases/:caseId/email-drafts/:draftId",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const draftId = req.params.draftId as string;
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      // Validate draft exists and belongs to case
      const existing = await getEmailDraftById(storage, draftId);
      if (!existing || existing.caseId !== workerCase.id) {
        return res.status(404).json({
          success: false,
          error: "Email draft not found",
        });
      }

      // Validate request body
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: "Invalid request body",
          details: parseResult.error.errors,
        });
      }

      const updated = await updateEmailDraft(storage, draftId, parseResult.data);

      res.json({
        success: true,
        data: updated,
      });
    } catch (error: any) {
      logger.api.error("Failed to update email draft", {}, error);
      res.status(500).json({
        success: false,
        error: "Failed to update email draft",
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /api/cases/:caseId/email-drafts/:draftId
 * Delete an email draft
 * SECURITY: requireCaseOwnership validates user can access this case
 */
router.delete(
  "/cases/:caseId/email-drafts/:draftId",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const draftId = req.params.draftId as string;
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      // Validate draft exists and belongs to case
      const existing = await getEmailDraftById(storage, draftId);
      if (!existing || existing.caseId !== workerCase.id) {
        return res.status(404).json({
          success: false,
          error: "Email draft not found",
        });
      }

      await deleteEmailDraft(storage, draftId);

      res.json({
        success: true,
        message: "Email draft deleted",
      });
    } catch (error: any) {
      logger.api.error("Failed to delete email draft", {}, error);
      res.status(500).json({
        success: false,
        error: "Failed to delete email draft",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/cases/:caseId/email-drafts/:draftId/send
 * Send an email draft via SMTP (or log in dev mode)
 */
router.post(
  "/cases/:caseId/email-drafts/:draftId/send",
  authorize(),
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const draftId = req.params.draftId as string;
      const workerCase = req.workerCase!;
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

      // Validate draft exists and belongs to case
      const existing = await getEmailDraftById(storage, draftId);
      if (!existing || existing.caseId !== workerCase.id) {
        return res.status(404).json({
          success: false,
          error: "Email draft not found",
        });
      }

      const result = await sendEmail({ to: recipientEmail, subject, body });

      if (!result.success) {
        logger.api.error("Failed to send email draft", { draftId, recipientEmail, error: result.error });
        return res.status(500).json({
          success: false,
          error: result.error || "Failed to send email",
        });
      }

      // Update draft with final content and mark as sent
      await updateEmailDraft(storage, draftId, {
        subject,
        body,
        recipientEmail,
        status: "sent",
      } as any);

      logger.api.info("Email draft sent successfully", { draftId, recipientEmail, messageId: result.messageId });

      return res.json({
        success: true,
        data: { messageId: result.messageId, recipientEmail },
      });
    } catch (error: any) {
      logger.api.error("Error sending email draft", { draftId: req.params.draftId }, error);
      res.status(500).json({
        success: false,
        error: "Failed to send email",
        message: error.message,
      });
    }
  }
);

export default router;
