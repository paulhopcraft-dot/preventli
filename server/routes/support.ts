/**
 * Support Routes
 *
 * Handles in-app support contact form submissions.
 * Forwards messages to support@preventli.com.au via the email service.
 */

import express, { Response } from "express";
import { z } from "zod";
import { authorize, type AuthRequest } from "../middleware/auth";
import { sendEmail } from "../services/emailService";
import { logger } from "../lib/logger";

const router = express.Router();

const ContactSchema = z.object({
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000),
});

/**
 * POST /api/support/contact
 * Authenticated users submit a support request.
 * Forwards to support@preventli.com.au with user context.
 */
router.post("/contact", authorize(), async (req: AuthRequest, res: Response) => {
  const parse = ContactSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ success: false, error: "Invalid request body" });
  }

  const { subject, message } = parse.data;
  const user = req.user!;

  const fromName = (user as any).name || user.email;
  const fromEmail = user.email;
  const orgId = user.organizationId ?? "unknown";

  const bodyText = `Support request from ${fromName} <${fromEmail}>
Organisation ID: ${orgId}
Role: ${user.role ?? "unknown"}

---
${message}
---

Sent via Preventli in-app support form.
`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:640px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#0A1628 0%,#0f766e 100%);padding:28px 30px;border-radius:10px 10px 0 0">
    <h2 style="color:white;margin:0;font-size:18px">Support Request — Preventli</h2>
  </div>
  <div style="background:#f9fafb;padding:28px 30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
      <tr><td style="padding:4px 0;color:#6b7280;width:130px">From</td><td style="padding:4px 0;font-weight:600">${fromName}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Email</td><td style="padding:4px 0"><a href="mailto:${fromEmail}" style="color:#0f766e">${fromEmail}</a></td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Organisation</td><td style="padding:4px 0">${orgId}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Role</td><td style="padding:4px 0">${user.role ?? "unknown"}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Subject</td><td style="padding:4px 0;font-weight:600">${subject}</td></tr>
    </table>
    <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;white-space:pre-wrap;font-size:14px;color:#374151">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    <p style="font-size:12px;color:#9ca3af;margin-top:20px 0 0">Sent via Preventli in-app support form · ${new Date().toISOString()}</p>
  </div>
</body>
</html>`;

  try {
    const result = await sendEmail({
      to: "support@preventli.ai",
      subject: `[Support] ${subject}`,
      body: bodyText,
      html: htmlBody,
    });

    if (!result.success) {
      logger.api.warn("Support email failed to send", { fromEmail, error: result.error });
      return res.status(500).json({ success: false, error: "Failed to send message" });
    }

    logger.api.info("Support request submitted", { fromEmail, subject });
    return res.json({ success: true });
  } catch (err) {
    logger.api.error("Support contact error", {}, err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
