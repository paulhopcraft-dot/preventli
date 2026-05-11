/**
 * Public routes — NO authentication required.
 * Used for worker magic-link questionnaire access.
 */
import express, { type Request, type Response, type Router } from "express";
import { storage } from "../storage";
import { createLogger } from "../lib/logger";
import { generateReport } from "../services/reportGenerator";

const logger = createLogger("PublicRoutes");
const router: Router = express.Router();

function isAssessmentSubmitted(assessment: Awaited<ReturnType<typeof storage.getAssessmentByToken>>): boolean {
  return assessment?.status === "completed" || Boolean(assessment?.questionnaireResponses);
}

/**
 * @route GET /api/public/check/:token
 * @desc Get assessment info for a worker (no auth — magic link)
 * @access Public
 */
router.get("/check/:token", async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const assessment = await storage.getAssessmentByToken(token);

    if (!assessment) {
      return res.status(404).json({ error: "Invalid or expired link" });
    }

    if (isAssessmentSubmitted(assessment)) {
      return res.status(410).json({ error: "This questionnaire has already been submitted" });
    }

    // Return only safe fields — no internal IDs or org data
    res.json({
      candidateName: assessment.candidateName,
      positionTitle: assessment.positionTitle,
      assessmentId: assessment.id,
      assessmentType: assessment.assessmentType ?? "baseline_health",
      organizationName: null, // populated below if we expose it
    });
  } catch (error) {
    logger.error("Error loading public check:", undefined, error);
    res.status(500).json({ error: "Failed to load assessment" });
  }
});

/**
 * @route POST /api/public/check/:token
 * @desc Submit questionnaire responses (no auth — magic link)
 * @access Public
 */
router.post("/check/:token", async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const { responses } = req.body as { responses: Record<string, unknown> };

    if (!responses || typeof responses !== "object") {
      return res.status(400).json({ error: "responses object is required" });
    }

    const assessment = await storage.getAssessmentByToken(token);
    if (!assessment) {
      return res.status(404).json({ error: "Invalid or expired link" });
    }
    if (assessment.status === "completed") {
      return res.status(410).json({ error: "Already submitted" });
    }

    // Save responses and mark in-progress
    await storage.updateAssessmentResponses(assessment.id, responses);

    // Trigger AI report generation (async — don't block worker's confirmation)
    // Pass assessment with responses merged in so generator doesn't need to re-fetch
    const assessmentWithResponses = { ...assessment, questionnaireResponses: responses };
    generateReport(assessmentWithResponses).catch((err) => {
      logger.error("Report generation failed:", undefined, err);
    });

    res.json({ success: true, message: "Thank you — your responses have been submitted." });
  } catch (error) {
    logger.error("Error submitting check:", undefined, error);
    res.status(500).json({ error: "Failed to submit questionnaire" });
  }
});

export default router;
