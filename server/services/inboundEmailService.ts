import { storage } from "../storage";
import { matchEmailToCase, detectsCertificateContent } from "./emailMatcher";
import { llmMatchEmailToCase } from "./llmEmailMatcher";
import { createLogger } from "../lib/logger";
import type { InsertCaseEmail, InsertEmailAttachment, CaseEmailDB } from "@shared/schema";

const log = createLogger("InboundEmail");

export interface InboundEmailPayload {
  messageId?: string;
  inReplyTo?: string;
  fromEmail: string;
  fromName?: string;
  toEmail?: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    sizeBytes: number;
    base64Data?: string;
  }>;
  source?: "sendgrid" | "demo" | "freshdesk" | "manual";
  /** Optional simulated date for demo/test scenarios (ISO string or Date) */
  receivedAt?: string | Date;
}

export interface ProcessResult {
  emailId: string;
  caseId: string | null;
  matchMethod: string;
  processingStatus: string;
  isNewCase: boolean;
  discussionNoteCreated: boolean;
  certificateDetected: boolean;
}

/**
 * Process an inbound email: store → match → discussion note → cert detection
 */
export async function processInboundEmail(payload: InboundEmailPayload): Promise<ProcessResult> {
  const {
    messageId,
    inReplyTo,
    fromEmail,
    fromName,
    toEmail,
    subject,
    bodyText,
    bodyHtml,
    attachments = [],
    source = "sendgrid",
    receivedAt: receivedAtRaw,
  } = payload;

  // Use provided receivedAt for demo scenarios, otherwise current time
  const effectiveDate = receivedAtRaw ? new Date(receivedAtRaw) : new Date();

  // Idempotency check: skip if we already have this message
  if (messageId) {
    const existing = await storage.getCaseEmailByMessageId(messageId);
    if (existing) {
      log.info("Duplicate email skipped", { messageId });
      return {
        emailId: existing.id,
        caseId: existing.caseId,
        matchMethod: existing.matchMethod || "none",
        processingStatus: existing.processingStatus,
        isNewCase: false,
        discussionNoteCreated: false,
        certificateDetected: false,
      };
    }
  }

  // 1. Store raw email
  const emailData: InsertCaseEmail = {
    messageId: messageId || null,
    inReplyTo: inReplyTo || null,
    fromEmail,
    fromName: fromName || null,
    toEmail: toEmail || null,
    subject,
    bodyText: bodyText || null,
    bodyHtml: bodyHtml || null,
    attachmentCount: attachments.length,
    attachmentsJson: attachments.map(a => ({
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
    })),
    processingStatus: "received",
    source,
    receivedAt: effectiveDate,
  } as any;

  const savedEmail = await storage.createCaseEmail(emailData);
  log.info("Email stored", { emailId: savedEmail.id, subject });

  // 2. Store attachments
  for (const att of attachments) {
    const attachmentData: InsertEmailAttachment = {
      emailId: savedEmail.id,
      filename: att.filename,
      contentType: att.contentType,
      sizeBytes: att.sizeBytes,
      base64Data: att.base64Data || null,
      isCertificate: isCertificateAttachment(att.filename, att.contentType),
    } as any;
    await storage.createEmailAttachment(attachmentData);
  }

  // 3. Match email to case (heuristic: thread / claim / sender / worker name)
  let match = await matchEmailToCase({
    messageId: savedEmail.messageId,
    inReplyTo: savedEmail.inReplyTo,
    fromEmail,
    fromName,
    subject,
    bodyText,
  });

  // 3a. LLM fuzzy-match fallback. Only runs when heuristics returned no match
  // AND a single-tenant default org is configured via env var. Tenant-safe by
  // design: searches one org only. Skipped when env var unset.
  if (!match.caseId) {
    const fallbackOrgId = process.env.PREVENTLI_DEFAULT_INBOUND_ORG_ID;
    if (fallbackOrgId) {
      const llmMatch = await llmMatchEmailToCase(
        { fromEmail, fromName, subject, bodyText },
        fallbackOrgId,
      );
      if (llmMatch) {
        match = llmMatch;
      }
    }
  }

  let caseId = match.caseId;
  let organizationId = match.organizationId;
  let isNewCase = false;
  let processingStatus = "matched";

  // 4. If no match, create new case from email content
  if (!caseId) {
    const newCaseInfo = extractCaseInfoFromEmail(subject, bodyText, fromEmail, fromName);
    if (newCaseInfo.workerName) {
      try {
        const newCase = await storage.createCase({
          organizationId: newCaseInfo.organizationId,
          workerName: newCaseInfo.workerName,
          company: newCaseInfo.company,
          dateOfInjury: new Date().toISOString().split("T")[0],
          workStatus: newCaseInfo.workStatus,
          riskLevel: newCaseInfo.riskLevel,
          summary: `Created from email: ${subject}`,
        });
        caseId = newCase.id;
        organizationId = newCase.organizationId;
        isNewCase = true;
        processingStatus = "case_created";
        log.info("New case created from email", { caseId, workerName: newCaseInfo.workerName });
      } catch (err) {
        log.error("Failed to create case from email", {}, err);
        processingStatus = "failed";
      }
    } else {
      processingStatus = "failed";
      log.warn("Could not extract worker name from email", { subject });
    }
  }

  // 5. Update email with match result
  await storage.updateCaseEmail(savedEmail.id, {
    caseId: caseId || null,
    organizationId: organizationId || null,
    processingStatus,
    matchMethod: match.method,
    matchConfidence: match.confidence ? String(match.confidence) : null,
  } as any);

  // 6. Create discussion note from email body
  let discussionNoteCreated = false;
  if (caseId && organizationId && bodyText) {
    try {
      const workerCase = await storage.getGPNet2CaseByIdAdmin(caseId);
      const workerName = workerCase?.workerName || "Unknown";

      const noteId = `email-${savedEmail.id}`;
      await storage.upsertCaseDiscussionNotes([{
        id: noteId,
        organizationId,
        caseId,
        workerName,
        timestamp: effectiveDate,
        rawText: `From: ${fromName || fromEmail}\nSubject: ${subject}\n\n${bodyText}`,
        summary: `Email from ${fromName || fromEmail}: ${subject}`,
        nextSteps: null,
        riskFlags: null,
        updatesCompliance: false,
        updatesRecoveryTimeline: detectsCertificateContent(subject, bodyText),
      } as any]);
      discussionNoteCreated = true;
    } catch (err) {
      log.error("Failed to create discussion note", {}, err);
    }
  }

  // 7. Detect certificate content
  const certificateDetected = detectsCertificateContent(subject, bodyText) ||
    attachments.some(a => isCertificateAttachment(a.filename, a.contentType));

  // 8. If certificate detected, add a medical certificate record
  if (certificateDetected && caseId) {
    try {
      await createCertificateFromEmail(caseId, subject, bodyText, fromName, effectiveDate);
    } catch (err) {
      log.error("Failed to create certificate from email", {}, err);
    }
  }

  return {
    emailId: savedEmail.id,
    caseId,
    matchMethod: match.method,
    processingStatus,
    isNewCase,
    discussionNoteCreated,
    certificateDetected,
  };
}

/**
 * Extract case info from email content for new case creation.
 */
function extractCaseInfoFromEmail(
  subject: string,
  bodyText: string | undefined,
  fromEmail: string,
  fromName: string | undefined,
): {
  workerName: string | null;
  company: string;
  organizationId: string;
  workStatus: string;
  riskLevel: string;
} {
  // Extract worker name from subject patterns
  const namePatterns = [
    /(?:Injury Report|Stress Claim|URGENT)[\s:\-–]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
    /(?:Medical Certificate|Certificate|Report)[\s:\-–]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
    /[-–]\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[-–,]/,
    /[-–]\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\s*$/,
  ];

  let workerName: string | null = null;
  const cleaned = subject.replace(/^(RE|FW|Fwd):\s*/gi, "").trim();

  for (const pattern of namePatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      workerName = match[1].trim();
      break;
    }
  }

  // Determine risk level from subject keywords
  let riskLevel = "Medium";
  const subjectLower = subject.toLowerCase();
  if (subjectLower.includes("urgent") || subjectLower.includes("ambulance") || subjectLower.includes("emergency")) {
    riskLevel = "High";
  }

  // Determine work status
  let workStatus = "Off work";

  // Default organization: Symmetry HR (org ID from seed data)
  // In production, this would be looked up from the sender's domain
  const organizationId = "org-alpha";

  return {
    workerName,
    company: "Symmetry HR",
    organizationId,
    workStatus,
    riskLevel,
  };
}

/**
 * Check if an attachment is likely a medical certificate.
 */
function isCertificateAttachment(filename: string, contentType: string): boolean {
  const nameLower = filename.toLowerCase();
  return (
    (contentType === "application/pdf" || nameLower.endsWith(".pdf")) &&
    (nameLower.includes("certificate") ||
      nameLower.includes("cert") ||
      nameLower.includes("medical") ||
      nameLower.includes("capacity") ||
      nameLower.includes("clearance"))
  );
}

/**
 * Parse a date from common formats: D/MM/YYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
 */
function parseFlexibleDate(dateStr: string): Date | null {
  // DD/MM/YYYY or D/MM/YYYY
  const dmy = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    return new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
  }
  // YYYY-MM-DD
  const ymd = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    return new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
  }
  return null;
}

/**
 * Extract start and end dates from email body text.
 * Looks for patterns like:
 *   "Period: 7/08/2025 to 21/08/2025"
 *   "Valid: 7/08/2025 to 21/08/2025"
 *   "Valid From: ... Valid Until: ..."
 */
function extractCertificateDates(text: string): { startDate: Date | null; endDate: Date | null } {
  // Pattern: "Period: DATE to DATE" or "Valid: DATE to DATE"
  const periodMatch = text.match(/(?:period|valid)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})\s+to\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (periodMatch) {
    return {
      startDate: parseFlexibleDate(periodMatch[1]),
      endDate: parseFlexibleDate(periodMatch[2]),
    };
  }

  // Pattern: "Valid From: DATE" ... "Valid Until: DATE" (may be on separate lines)
  const fromMatch = text.match(/valid\s*from[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const untilMatch = text.match(/valid\s*(?:until|to)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (fromMatch || untilMatch) {
    return {
      startDate: fromMatch ? parseFlexibleDate(fromMatch[1]) : null,
      endDate: untilMatch ? parseFlexibleDate(untilMatch[1]) : null,
    };
  }

  return { startDate: null, endDate: null };
}

/**
 * Create a basic medical certificate record from email content.
 * Extracts capacity, dates, and notes from the email body.
 */
async function createCertificateFromEmail(
  caseId: string,
  subject: string,
  bodyText: string | undefined,
  fromName: string | undefined,
  effectiveDate: Date,
): Promise<void> {
  const text = `${subject} ${bodyText || ""}`.toLowerCase();
  const fullText = `${subject} ${bodyText || ""}`;

  // Determine capacity from keywords
  let capacity = "unknown";
  if (text.includes("unfit") || text.includes("unable to work") || text.includes("no current work capacity")) {
    capacity = "unfit";
  } else if (text.includes("partial") || text.includes("light duties") || text.includes("modified") || text.includes("suitable employment")) {
    capacity = "partial";
  } else if (text.includes("fit for full") || text.includes("full duties") || text.includes("clearance") || text.includes("pre-injury")) {
    capacity = "fit";
  }

  // Try to extract explicit dates from the email body
  const parsed = extractCertificateDates(fullText);
  const startDate = parsed.startDate || effectiveDate;
  let endDate = parsed.endDate;

  // If no explicit end date, compute from duration keywords or default 2 weeks
  if (!endDate) {
    const durationMatch = text.match(/(\d+)\s*weeks?/i);
    if (durationMatch) {
      const weeks = parseInt(durationMatch[1]);
      endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
    } else {
      endDate = new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);
    }
  }

  // Issue date = start date (most certificates are issued on start date)
  const issueDate = parsed.startDate || effectiveDate;

  // Extract notes from body (first 500 chars)
  const notes = bodyText ? bodyText.substring(0, 500).trim() : subject;

  await storage.createCertificate({
    caseId,
    issueDate,
    startDate,
    endDate,
    capacity,
    notes: `${fromName ? `Issued by: ${fromName}\n` : ""}${notes}`,
    source: "manual",
    sourceReference: `inbound-email`,
    certificateType: "medical_certificate",
    treatingPractitioner: fromName || null,
  } as any);

  log.info("Certificate created from email", { caseId, capacity, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
}
