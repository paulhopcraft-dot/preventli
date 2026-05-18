import { Router, Request, Response } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { processInboundEmail } from "../services/inboundEmailService";
import { detectDistress } from "../services/distressDetector";
import { storage } from "../storage";
import { auditLog } from "../lib/auditLog";
import { createLogger } from "../lib/logger";

const log = createLogger("InboundEmailRoute");
const router = Router();

// Rate limit: 120 requests per minute for webhooks
const inboundEmailRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Rate limit exceeded. Maximum 120 emails per minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Zod schema for inbound email payload
const inboundEmailSchema = z.object({
  messageId: z.string().optional(),
  inReplyTo: z.string().optional(),
  fromEmail: z.string().email("Invalid sender email"),
  fromName: z.string().optional(),
  toEmail: z.string().optional(),
  subject: z.string().min(1, "Subject is required"),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int().min(0),
    base64Data: z.string().optional(),
  })).optional(),
  source: z.enum(["sendgrid", "postmark", "demo", "freshdesk", "manual"]).optional(),
  receivedAt: z.string().optional(),
});

/**
 * Verify webhook secret using timing-safe comparison.
 * Returns true if verification passes or if no secret is configured (dev mode).
 */
function verifyWebhookSecret(req: Request): boolean {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!secret) {
    log.error("INBOUND_EMAIL_WEBHOOK_SECRET not configured - rejecting all webhook requests");
    return false;
  }

  const provided = req.headers["x-webhook-secret"] as string;
  if (!provided) {
    return false;
  }

  try {
    const secretBuf = Buffer.from(secret, "utf8");
    const providedBuf = Buffer.from(provided, "utf8");
    if (secretBuf.length !== providedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(secretBuf, providedBuf);
  } catch {
    return false;
  }
}

/**
 * POST /api/inbound-email
 * Receives parsed emails from SendGrid, demo scenarios, or other sources.
 * Authenticated via webhook secret header (not CSRF/JWT).
 */
router.post("/", inboundEmailRateLimiter, async (req: Request, res: Response) => {
  // Verify webhook authentication
  if (!verifyWebhookSecret(req)) {
    log.warn("Webhook authentication failed", { ip: req.ip });
    return res.status(401).json({ error: "Unauthorized: invalid webhook secret" });
  }

  // Validate payload
  const parseResult = inboundEmailSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "Invalid email payload",
      details: parseResult.error.errors.map(e => `${e.path.join(".")}: ${e.message}`),
    });
  }

  try {
    const result = await processInboundEmail(parseResult.data as Parameters<typeof processInboundEmail>[0]);

    log.info("Email processed", {
      emailId: result.emailId,
      caseId: result.caseId,
      matchMethod: result.matchMethod,
      status: result.processingStatus,
      isNewCase: result.isNewCase,
    });

    // Distress signal detection (funding-bundle 1.4 — mental-injury defensibility)
    // Non-blocking: errors here must not affect the inbound-email response.
    try {
      if (result.caseId) {
        const workerCase = await storage.getGPNet2CaseByIdAdmin(result.caseId);
        if (workerCase?.workerId) {
          const detection = await detectDistress({
            subject: parseResult.data.subject,
            bodyText: parseResult.data.bodyText ?? "",
            workerId: workerCase.workerId,
          });
          if (detection && detection.isDistress && detection.confidence >= 0.7) {
            const suppression = await storage.createContactSuppression({
              workerId: workerCase.workerId,
              reason: `Alex detected distress signal: ${detection.rationale}`,
              source: "alex",
              llmModel: detection.llm.model,
              llmPrompt: detection.llm.prompt,
              llmResponse: detection.llm.response,
            } as any);
            await auditLog({
              workerId: workerCase.workerId,
              caseId: result.caseId,
              eventType: "contact.suppressed",
              actor: "alex",
              payload: {
                suppressionId: suppression.id,
                confidence: detection.confidence,
                preFilterMatches: detection.preFilterMatches,
              },
              llm: detection.llm,
            });
            log.info("Alex flagged distress signal", {
              workerId: workerCase.workerId,
              suppressionId: suppression.id,
            });
          } else if (detection) {
            log.info("Distress detection below threshold — no suppression created", {
              workerId: workerCase.workerId,
              isDistress: detection.isDistress,
              confidence: detection.confidence,
            });
          }
        }
      }
    } catch (err) {
      log.error("Distress detection failed (non-blocking)", {}, err);
    }

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    log.error("Failed to process inbound email", {}, err);
    res.status(500).json({
      error: "Failed to process email",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
