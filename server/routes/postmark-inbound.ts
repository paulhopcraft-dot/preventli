import { Router, Request, Response } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  processInboundEmail,
  type InboundEmailPayload,
} from "../services/inboundEmailService";
import { createLogger } from "../lib/logger";

const log = createLogger("PostmarkInboundRoute");
const router = Router();

// Rate limit mirrors the generic inbound-email route — Postmark won't exceed
// this in practice, but the limiter shields us from anyone who learns the URL
// and the basic-auth secret leaking.
const postmarkRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Rate limit exceeded. Maximum 120 emails per minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Postmark payload shape (subset; see https://postmarkapp.com/developer/webhooks/inbound-webhook)
// ─────────────────────────────────────────────────────────────────────────────

export const postmarkInboundSchema = z.object({
  From: z.string().email(),
  FromName: z.string().optional(),
  FromFull: z.object({
    Email: z.string().email(),
    Name: z.string().optional(),
  }).optional(),
  To: z.string().optional(),
  Subject: z.string().min(1),
  MessageID: z.string().optional(),
  TextBody: z.string().optional(),
  HtmlBody: z.string().optional(),
  Date: z.string().optional(),
  Headers: z
    .array(z.object({ Name: z.string(), Value: z.string() }))
    .optional(),
  Attachments: z
    .array(
      z.object({
        Name: z.string(),
        ContentType: z.string(),
        ContentLength: z.number().int().min(0),
        Content: z.string().optional(),
      })
    )
    .optional(),
});

export type PostmarkInboundPayload = z.infer<typeof postmarkInboundSchema>;

/**
 * Translate Postmark inbound JSON to our internal InboundEmailPayload.
 * Pure function — no I/O, no env reads. Tested in isolation.
 *
 * `In-Reply-To` lives in `Headers[]` not at the top level, so we scan there.
 */
export function postmarkToInternal(p: PostmarkInboundPayload): InboundEmailPayload {
  const inReplyToHeader = p.Headers?.find(
    (h) => h.Name.toLowerCase() === "in-reply-to",
  )?.Value;

  return {
    messageId: p.MessageID,
    inReplyTo: inReplyToHeader,
    fromEmail: p.FromFull?.Email ?? p.From,
    fromName: p.FromFull?.Name ?? p.FromName,
    toEmail: p.To,
    subject: p.Subject,
    bodyText: p.TextBody,
    bodyHtml: p.HtmlBody,
    attachments: p.Attachments?.map((a) => ({
      filename: a.Name,
      contentType: a.ContentType,
      sizeBytes: a.ContentLength,
      base64Data: a.Content,
    })),
    source: "postmark",
    receivedAt: p.Date,
  };
}

/**
 * Verify Postmark webhook basic-auth credentials. Postmark's recommended
 * spoof protection is HTTP basic-auth on the webhook URL itself:
 *
 *   https://USER:PASSWORD@app.preventli.ai/api/webhooks/postmark/inbound
 *
 * Both env vars MUST be set; absence = reject. Comparison is timing-safe.
 */
export function verifyPostmarkBasicAuth(req: Request): boolean {
  const expectedUser = process.env.POSTMARK_WEBHOOK_USER;
  const expectedPass = process.env.POSTMARK_WEBHOOK_PASSWORD;
  if (!expectedUser || !expectedPass) {
    log.error("POSTMARK_WEBHOOK_USER / POSTMARK_WEBHOOK_PASSWORD not configured — rejecting all Postmark requests");
    return false;
  }

  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Basic ")) {
    return false;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }

  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const providedUser = decoded.slice(0, sep);
  const providedPass = decoded.slice(sep + 1);

  return (
    timingSafeStringEq(providedUser, expectedUser) &&
    timingSafeStringEq(providedPass, expectedPass)
  );
}

function timingSafeStringEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * POST /api/webhooks/postmark/inbound
 * Receives Postmark Inbound parsed-JSON webhooks.
 */
router.post("/inbound", postmarkRateLimiter, async (req: Request, res: Response) => {
  if (!verifyPostmarkBasicAuth(req)) {
    log.warn("Postmark webhook auth failed", { ip: req.ip });
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = postmarkInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid Postmark payload",
      details: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
    });
  }

  const internal = postmarkToInternal(parsed.data);

  try {
    const result = await processInboundEmail(internal);
    log.info("Postmark email processed", {
      emailId: result.emailId,
      caseId: result.caseId,
      matchMethod: result.matchMethod,
      status: result.processingStatus,
      isNewCase: result.isNewCase,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    log.error("Failed to process Postmark email", {}, err);
    return res.status(500).json({
      error: "Failed to process email",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
