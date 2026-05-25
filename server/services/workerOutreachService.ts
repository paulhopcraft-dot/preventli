/**
 * Worker Outreach Cadence Service
 *
 * Automatically contacts workers when their medical certificate is about to
 * expire, then alerts the HR manager if no response arrives within 3 days.
 *
 * Cadence:
 *   Day 0  (cert ≤7 days from expiry) → Email worker
 *   Day 3  (no response, no new cert) → Email HR manager alert
 *   Ongoing (cert expired, no renewal) → Email worker + manager
 *
 * All outreach is logged in worker_outreach_log for deduplication and audit.
 * Inbound email ingestion calls markOutreachResponded() to close the loop.
 */

import { db } from "../db";
import { workerOutreachLog, outreachTemplates, agentJobs, type OutreachTrigger } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { storage } from "../storage";
import { getCaseCompliance } from "./certificateCompliance";
import { sendEmail } from "./emailService";
import { createLogger } from "../lib/logger";
import { runSpecialistAgent } from "../agents/agent-runner";

const logger = createLogger("WorkerOutreach");

const APP_URL = process.env.APP_URL ?? "https://app.preventli.ai";
const MANAGER_ALERT_EMAIL = process.env.NOTIFICATION_DEFAULT_EMAIL ?? "admin@preventli.ai";

// ─── Default templates ────────────────────────────────────────────────────────
// Stored in code as fallback; orgs can override per trigger via the API.

const DEFAULT_TEMPLATES: Record<OutreachTrigger, { subject: string; body: string }> = {
  cert_expiring_7d: {
    subject: "Action required: Your medical certificate expires in {{daysUntil}} days",
    body: `Hi {{workerName}},

We hope your recovery is going well.

This is a reminder that your medical certificate expires on {{expiryDate}} — that's in {{daysUntil}} days.

Please arrange with your treating doctor to issue a new certificate before this date. You can email your new certificate directly to support@preventli.ai and it will be automatically added to your case.

If you have any questions, reply to this email and your case manager will be in touch.

Warm regards,
The Preventli Team`,
  },

  cert_expired: {
    subject: "URGENT: Your medical certificate has expired — please send a renewal",
    body: `Hi {{workerName}},

Your medical certificate expired on {{expiryDate}}.

Please contact your treating doctor today to obtain a new certificate and email it to support@preventli.ai as soon as possible.

If you have already sent your certificate, please disregard this message.

Warm regards,
The Preventli Team`,
  },

  manager_no_response: {
    subject: "Alert: {{workerName}} has not responded to certificate renewal request",
    body: `Hi,

This is an automated alert from Preventli.

We sent a certificate renewal reminder to {{workerName}} ({{company}}) on {{outreachDate}} and have not received a response or new certificate after 3 days.

Their certificate expires on {{expiryDate}}.

Recommended next steps:
1. Contact {{workerName}} directly by phone
2. Chase their treating doctor for a new certificate
3. Escalate to the insurer if no response within 7 days

View this case: {{caseUrl}}

Preventli Automated Alerts`,
  },

  cert_downgraded: {
    subject: "Your recovery update — please complete a short check",
    body: `Hi {{workerName}},

We've noticed a change in your work capacity based on your latest medical certificate. To make sure your Return to Work plan reflects where you're at now, we'd like you to complete a short Prevention Check.

This will only take a few minutes and helps your case manager understand how you're going and update your plan accordingly.

Complete your check here:
{{checkLink}}

This link is personal to you. Please don't share it.

If you have any questions, please reply to this email.

Warm regards,
The Preventli Team`,
  },
};

// ─── Template interpolation ───────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{{${key}}}`
  );
}

// ─── Template resolution ──────────────────────────────────────────────────────

async function getTemplate(
  organizationId: string,
  trigger: OutreachTrigger
): Promise<{ subject: string; body: string }> {
  try {
    const [orgTemplate] = await db
      .select()
      .from(outreachTemplates)
      .where(
        and(
          eq(outreachTemplates.organizationId, organizationId),
          eq(outreachTemplates.trigger, trigger),
          eq(outreachTemplates.isActive, true)
        )
      )
      .limit(1);

    if (orgTemplate) {
      return { subject: orgTemplate.subject, body: orgTemplate.body };
    }
  } catch {
    // DB error — fall back to default
  }
  return DEFAULT_TEMPLATES[trigger];
}

// ─── Deduplication helpers ────────────────────────────────────────────────────

async function getOutreachByDedupeKey(
  dedupeKey: string
): Promise<typeof workerOutreachLog.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(workerOutreachLog)
    .where(eq(workerOutreachLog.dedupeKey, dedupeKey))
    .limit(1);
  return row ?? null;
}

async function createOutreachRecord(
  data: typeof workerOutreachLog.$inferInsert
): Promise<typeof workerOutreachLog.$inferSelect> {
  const [row] = await db.insert(workerOutreachLog).values(data).returning();
  return row;
}

// ─── Manager alert ────────────────────────────────────────────────────────────

async function sendManagerNoResponseAlert(
  organizationId: string,
  workerCase: { id: string; workerName: string; company: string },
  expiryDate: string,
  workerOutreachSentAt: Date,
  dedupeKey: string
): Promise<void> {
  const template = await getTemplate(organizationId, "manager_no_response");
  const outreachDate = workerOutreachSentAt.toLocaleDateString("en-AU");
  const caseUrl = `${APP_URL}/cases/${workerCase.id}`;

  const subject = interpolate(template.subject, {
    workerName: workerCase.workerName,
    company: workerCase.company,
    expiryDate,
    outreachDate,
    caseUrl,
  });
  const body = interpolate(template.body, {
    workerName: workerCase.workerName,
    company: workerCase.company,
    expiryDate,
    outreachDate,
    caseUrl,
  });

  const result = await sendEmail({ to: MANAGER_ALERT_EMAIL, subject, body });

  if (result.success) {
    await createOutreachRecord({
      organizationId,
      caseId: workerCase.id,
      trigger: "manager_no_response",
      channel: "email",
      recipientEmail: MANAGER_ALERT_EMAIL,
      recipientType: "manager",
      subject,
      bodyPreview: body.slice(0, 500),
      status: "sent",
      dedupeKey,
      metadata: { workerName: workerCase.workerName, expiryDate },
    });
    logger.info("Manager no-response alert sent", { caseId: workerCase.id, workerName: workerCase.workerName });
  }
}

// ─── Main cadence runner ──────────────────────────────────────────────────────

/**
 * Run the full worker outreach cadence for one organisation.
 * Call this daily from the agent scheduler.
 */
export async function runWorkerOutreachCadence(
  organizationId: string
): Promise<{ workerEmailsSent: number; managerAlertsSent: number; failed: number }> {
  let workerEmailsSent = 0;
  let managerAlertsSent = 0;
  let failed = 0;

  logger.info("Running worker outreach cadence", { organizationId });

  let cases: Awaited<ReturnType<typeof storage.getCases>> = [];
  try {
    cases = await storage.getCases(organizationId);
  } catch (err) {
    logger.error("Failed to load cases for outreach", { organizationId, error: err });
    return { workerEmailsSent, managerAlertsSent, failed };
  }

  for (const workerCase of cases) {
    try {
      const compliance = await getCaseCompliance(storage, workerCase.id, organizationId);

      const isExpiringSoon = compliance.status === "certificate_expiring_soon";
      const isExpired = compliance.status === "certificate_expired";

      if (!isExpiringSoon && !isExpired) continue;

      const daysUntilExpiry = compliance.daysUntilExpiry ?? 0;

      // Only act within the 7-day window for expiring certs
      if (isExpiringSoon && daysUntilExpiry > 7) continue;

      // Get worker email from contacts
      let workerEmail: string | null = null;
      try {
        const contacts = await storage.getCaseContactsByRole(workerCase.id, organizationId, "worker");
        const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
        const email = primary?.email?.trim();
        if (email && email.includes("@") && email.includes(".")) {
          workerEmail = email;
        }
      } catch {
        // contacts load failure is non-fatal
      }

      if (!workerEmail) {
        logger.debug("No worker email for outreach", { caseId: workerCase.id, workerName: workerCase.workerName });
        continue;
      }

      const cert = compliance.activeCertificate;
      const expiryDate = cert
        ? new Date(cert.endDate).toLocaleDateString("en-AU")
        : "Unknown";

      const trigger: OutreachTrigger = isExpired ? "cert_expired" : "cert_expiring_7d";
      // Bucket by week so we don't re-send if run multiple times in 7 days
      const weekBucket = isExpired ? "expired" : String(Math.ceil(daysUntilExpiry / 7));
      const workerDedupeKey = `outreach:${workerCase.id}:${trigger}:${weekBucket}`;

      const existingOutreach = await getOutreachByDedupeKey(workerDedupeKey);

      if (existingOutreach) {
        // Already sent — check if HR manager alert is needed (no response in 3 days)
        if (!existingOutreach.respondedAt) {
          const daysSinceSent = Math.floor(
            (Date.now() - new Date(existingOutreach.sentAt).getTime()) / (86_400_000)
          );
          if (daysSinceSent >= 3) {
            const managerDedupeKey = `outreach:${workerCase.id}:manager_no_response:${existingOutreach.id}`;
            const managerAlertExists = await getOutreachByDedupeKey(managerDedupeKey);
            if (!managerAlertExists) {
              await sendManagerNoResponseAlert(
                organizationId,
                workerCase,
                expiryDate,
                new Date(existingOutreach.sentAt),
                managerDedupeKey
              );
              managerAlertsSent++;
            }
          }
        }
        continue; // Worker email already sent this cycle
      }

      // ── Send worker outreach email ─────────────────────────────────────
      const template = await getTemplate(organizationId, trigger);
      const subject = interpolate(template.subject, {
        workerName: workerCase.workerName,
        daysUntil: daysUntilExpiry,
        expiryDate,
        company: workerCase.company ?? "",
      });
      const body = interpolate(template.body, {
        workerName: workerCase.workerName,
        daysUntil: daysUntilExpiry,
        expiryDate,
        company: workerCase.company ?? "",
        caseUrl: `${APP_URL}/cases/${workerCase.id}`,
      });

      const result = await sendEmail({ to: workerEmail, subject, body });

      if (result.success) {
        await createOutreachRecord({
          organizationId,
          caseId: workerCase.id,
          trigger,
          channel: "email",
          recipientEmail: workerEmail,
          recipientType: "worker",
          subject,
          bodyPreview: body.slice(0, 500),
          status: "sent",
          dedupeKey: workerDedupeKey,
          metadata: { daysUntilExpiry, expiryDate, workerName: workerCase.workerName },
        });
        logger.info("Worker outreach sent", {
          caseId: workerCase.id,
          workerName: workerCase.workerName,
          trigger,
          daysUntilExpiry,
        });
        workerEmailsSent++;
      } else {
        logger.warn("Worker outreach email failed", {
          caseId: workerCase.id,
          workerEmail,
          error: result.error,
        });
        failed++;
      }
    } catch (err) {
      logger.error("Outreach failed for case", { caseId: workerCase.id, error: err });
      failed++;
    }
  }

  logger.info("Worker outreach cadence complete", { organizationId, workerEmailsSent, managerAlertsSent, failed });
  return { workerEmailsSent, managerAlertsSent, failed };
}

// ─── Response tracking ────────────────────────────────────────────────────────

/**
 * Mark all open outreach records for a case as responded.
 * Called by inboundEmailService when a case-matched email arrives from the worker.
 */
export async function markOutreachResponded(caseId: string): Promise<void> {
  try {
    await db
      .update(workerOutreachLog)
      .set({ respondedAt: new Date(), status: "responded" })
      .where(
        and(
          eq(workerOutreachLog.caseId, caseId),
          eq(workerOutreachLog.recipientType, "worker"),
          eq(workerOutreachLog.status, "sent")
        )
      );
    logger.info("Outreach marked responded", { caseId });
  } catch (err) {
    logger.error("Failed to mark outreach responded", { caseId, error: err });
  }
}

// ─── Template management ──────────────────────────────────────────────────────

/**
 * Get the effective template for a trigger (org override or default).
 * Returns the template body/subject with placeholder names documented.
 */
export async function getEffectiveTemplate(
  organizationId: string,
  trigger: OutreachTrigger
): Promise<{
  trigger: OutreachTrigger;
  subject: string;
  body: string;
  isCustom: boolean;
  placeholders: string[];
}> {
  let isCustom = false;
  let tmpl = DEFAULT_TEMPLATES[trigger];

  try {
    const [orgTemplate] = await db
      .select()
      .from(outreachTemplates)
      .where(
        and(
          eq(outreachTemplates.organizationId, organizationId),
          eq(outreachTemplates.trigger, trigger),
          eq(outreachTemplates.isActive, true)
        )
      )
      .limit(1);

    if (orgTemplate) {
      tmpl = { subject: orgTemplate.subject, body: orgTemplate.body };
      isCustom = true;
    }
  } catch {
    // fall back to defaults
  }

  return {
    trigger,
    subject: tmpl.subject,
    body: tmpl.body,
    isCustom,
    placeholders: ["workerName", "expiryDate", "daysUntil", "company", "caseUrl", "outreachDate"],
  };
}

/**
 * Upsert an org-specific template for a trigger.
 */
export async function upsertOutreachTemplate(
  organizationId: string,
  trigger: OutreachTrigger,
  subject: string,
  body: string
): Promise<void> {
  const [existing] = await db
    .select()
    .from(outreachTemplates)
    .where(
      and(
        eq(outreachTemplates.organizationId, organizationId),
        eq(outreachTemplates.trigger, trigger)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(outreachTemplates)
      .set({ subject, body, updatedAt: new Date() })
      .where(eq(outreachTemplates.id, existing.id));
  } else {
    await db.insert(outreachTemplates).values({
      organizationId,
      trigger,
      subject,
      body,
      isActive: true,
    });
  }
}

/**
 * Get outreach history for a case (most recent first).
 */
export async function getCaseOutreachLog(
  caseId: string
): Promise<Array<typeof workerOutreachLog.$inferSelect>> {
  return db
    .select()
    .from(workerOutreachLog)
    .where(eq(workerOutreachLog.caseId, caseId))
    .orderBy(workerOutreachLog.sentAt);
}

// ─── RTW review trigger ───────────────────────────────────────────────────────

/**
 * Queue an RTW agent job to review Prevention Check responses and suggest
 * RTW plan updates. Called when a worker completes a check triggered by
 * a cert capacity downgrade.
 *
 * Runs fire-and-forget — the agent job runs in background and surfaces
 * its recommendation as a case notification for the case manager.
 */
export async function scheduleRTWReviewAfterPreventionCheck(
  assessmentId: string,
  caseId: string,
  organizationId: string,
  questionnaireResponses: Record<string, unknown>
): Promise<void> {
  try {
    logger.info("Scheduling RTW plan review after Prevention Check", { assessmentId, caseId });

    const [job] = await db
      .insert(agentJobs)
      .values({
        organizationId,
        caseId,
        agentType: "rtw",
        status: "queued",
        triggeredBy: "prevention_check",
        context: {
          mode: "prevention_check_review",
          assessmentId,
          questionnaireResponses,
          runDate: new Date().toISOString(),
        },
      } as any)
      .returning();

    // Fire in background — do not await (don't block the worker's submission response)
    setImmediate(async () => {
      await runSpecialistAgent(job.id).catch((err) => {
        logger.error("RTW review agent failed after Prevention Check", { caseId, assessmentId }, err);
      });
    });

    logger.info("RTW review job queued", { jobId: job.id, caseId });
  } catch (err) {
    logger.error("Failed to schedule RTW plan review", { assessmentId, caseId }, err);
    // Non-fatal — outreach cadence continues even if agent scheduling fails
  }
}

// ─── Certificate downgrade detection ─────────────────────────────────────────

// Capacity rank: higher = better. A drop in rank is a downgrade.
const CAPACITY_RANK: Record<string, number> = {
  fit: 3,
  partial: 2,
  unfit: 1,
  unknown: 0,
};

function capacityRank(capacity: string): number {
  return CAPACITY_RANK[capacity?.toLowerCase()] ?? 0;
}

/**
 * Called immediately after a new certificate is saved for a case.
 *
 * Compares the new cert's capacity against the previous cert. If lower
 * (i.e. worker has gone backwards), automatically sends a Prevention Check
 * invite so the case manager can understand where the worker is at and
 * update the RTW plan accordingly.
 *
 * @param caseId         The case the new cert belongs to
 * @param newCapacity    Capacity value on the newly saved cert ("fit"|"partial"|"unfit")
 * @param organizationId Organisation the case belongs to
 */
export async function checkAndTriggerDowngradeOutreach(
  caseId: string,
  newCapacity: string,
  organizationId: string
): Promise<void> {
  try {
    // Get the two most recent certs — [0] = newest (just saved), [1] = previous
    const certs = await storage.getCertificatesByCase(caseId, organizationId);
    if (certs.length < 2) return; // No previous cert to compare against

    // Sort by startDate descending — most recent first
    const sorted = [...certs].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );

    const prevCapacity = sorted[1]?.capacity ?? "unknown";
    const newRank = capacityRank(newCapacity);
    const prevRank = capacityRank(prevCapacity);

    if (newRank >= prevRank) return; // No downgrade — nothing to do

    logger.info("Capacity downgrade detected — triggering Prevention Check", {
      caseId,
      prevCapacity,
      newCapacity,
    });

    // Dedup: only send one downgrade check per cert cycle
    const dedupeKey = `outreach:${caseId}:cert_downgraded:${prevCapacity}→${newCapacity}:${sorted[0]?.id}`;
    const existing = await getOutreachByDedupeKey(dedupeKey);
    if (existing) return;

    // Get worker email
    let workerEmail: string | null = null;
    let workerName = "Worker";
    try {
      const workerCase = await storage.getGPNet2CaseByIdAdmin?.(caseId);
      workerName = (workerCase as { workerName?: string } | null)?.workerName ?? "Worker";
      const contacts = await storage.getCaseContactsByRole(caseId, organizationId, "worker");
      const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
      const email = primary?.email?.trim();
      if (email && email.includes("@")) workerEmail = email;
    } catch {
      // non-fatal
    }

    if (!workerEmail) {
      logger.warn("Downgrade detected but no worker email — skipping Prevention Check", { caseId });
      return;
    }

    // Create a Prevention Check assessment
    const accessToken = crypto.randomBytes(32).toString("hex");
    const checkLink = `${APP_URL}/check/${accessToken}`;

    let assessmentId: string | null = null;
    try {
      const assessment = await storage.createPreEmploymentAssessment({
        organizationId,
        candidateName: workerName,
        candidateEmail: workerEmail,
        positionTitle: "Return to Work — Capacity Review",
        assessmentType: "prevention",
        checkCategory: "prevention",
        accessToken,
        status: "pending",
        caseId,
      } as Parameters<typeof storage.createPreEmploymentAssessment>[0]);
      assessmentId = assessment.id;
    } catch (err) {
      logger.error("Failed to create Prevention Check assessment", { caseId, error: err });
      // Still send the email even if DB record fails
    }

    // Send Prevention Check invite to worker
    const subject = `Your recovery update — please complete a short check`;
    const body = `Hi ${workerName},

We've noticed a change in your work capacity based on your latest medical certificate. To make sure your Return to Work plan reflects where you're at now, we'd like you to complete a short Prevention Check.

This will only take a few minutes and helps your case manager understand how you're going and update your plan accordingly.

Complete your check here:
${checkLink}

This link is personal to you. Please don't share it.

If you have any questions, please reply to this email.

Warm regards,
The Preventli Team`;

    const result = await sendEmail({ to: workerEmail, subject, body });

    if (result.success) {
      await createOutreachRecord({
        organizationId,
        caseId,
        trigger: "cert_downgraded",
        channel: "email",
        recipientEmail: workerEmail,
        recipientType: "worker",
        subject,
        bodyPreview: body.slice(0, 500),
        status: "sent",
        dedupeKey,
        metadata: {
          prevCapacity,
          newCapacity,
          assessmentId,
          checkLink,
          workerName,
        },
      });
      logger.info("Prevention Check invite sent after capacity downgrade", {
        caseId,
        workerEmail,
        prevCapacity,
        newCapacity,
      });
    }
  } catch (err) {
    logger.error("Downgrade outreach check failed", { caseId, error: err });
  }
}
