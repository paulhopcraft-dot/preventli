import { storage } from "../storage";
import { createLogger } from "../lib/logger";

const log = createLogger("EmailMatcher");

export interface MatchResult {
  caseId: string | null;
  organizationId: string | null;
  method: "thread" | "claim_number" | "sender_email" | "worker_name" | "llm" | "new_case" | "none";
  confidence: number;
}

/**
 * Match an inbound email to an existing worker case.
 * Priority order: thread → claim number → sender email → worker name → no match
 */
export async function matchEmailToCase(email: {
  messageId?: string | null;
  inReplyTo?: string | null;
  fromEmail: string;
  fromName?: string | null;
  subject: string;
  bodyText?: string | null;
}): Promise<MatchResult> {
  // 1. Thread match via In-Reply-To header
  if (email.inReplyTo) {
    const parentEmail = await storage.getCaseEmailByMessageId(email.inReplyTo);
    if (parentEmail?.caseId && parentEmail?.organizationId) {
      log.info("Matched by thread", { inReplyTo: email.inReplyTo, caseId: parentEmail.caseId });
      return {
        caseId: parentEmail.caseId,
        organizationId: parentEmail.organizationId,
        method: "thread",
        confidence: 1.0,
      };
    }
  }

  // 2. Claim number from subject (e.g., "08260050789" or "Claim #08260050789")
  const claimNumberMatch = email.subject.match(/\b(0\d{10})\b/);
  if (claimNumberMatch) {
    const claimNumber = claimNumberMatch[1];
    // Search for this claim number in case summaries or ticket IDs
    // For now, look in subject/summary fields - in future could search a claim_numbers table
    log.debug("Found claim number in subject", { claimNumber });
  }

  // 3. Sender email → case_contacts lookup
  const contactMatch = await storage.findCaseContactByEmail(email.fromEmail);
  if (contactMatch) {
    log.info("Matched by sender email via contacts", { email: email.fromEmail, caseId: contactMatch.caseId });
    return {
      caseId: contactMatch.caseId,
      organizationId: contactMatch.organizationId,
      method: "sender_email",
      confidence: 0.9,
    };
  }

  // 4. Worker name extraction from subject
  const workerName = extractWorkerNameFromSubject(email.subject);
  if (workerName) {
    const caseMatch = await storage.findCaseByWorkerName(workerName);
    if (caseMatch && caseMatch.confidence > 0.7) {
      log.info("Matched by worker name", { workerName, caseId: caseMatch.caseId, confidence: caseMatch.confidence });
      return {
        caseId: caseMatch.caseId,
        organizationId: caseMatch.organizationId,
        method: "worker_name",
        confidence: caseMatch.confidence * 0.8, // Discount slightly for name-only match
      };
    }
  }

  // 5. No match
  log.info("No case match found", { subject: email.subject, from: email.fromEmail });
  return { caseId: null, organizationId: null, method: "none", confidence: 0 };
}

/**
 * Extract worker name from common email subject patterns:
 * - "Injury Report: Sarah Mitchell - Broken Arm"
 * - "Medical Certificate - Sarah Mitchell"
 * - "RE: Sarah Mitchell - Weekly Update"
 * - "Updated Certificate - Sarah Mitchell"
 */
function extractWorkerNameFromSubject(subject: string): string | null {
  // Strip RE:/FW: prefixes
  const cleaned = subject.replace(/^(RE|FW|Fwd):\s*/gi, "").trim();

  // Pattern: "Something - Name - Something" or "Something: Name - Something"
  const patterns = [
    // "Injury Report: First Last - Description" or "Stress Claim - First Last"
    /(?:Injury Report|Medical Certificate|Certificate|Assessment Report|ED Report|MRI Report|Rehab Program|Progress Report|Updated Certificate|Final Certificate|Stress Claim)[\s:\-–]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
    // "RE: First Last - Description"
    /^([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[-–]/,
    // "Something - First Last" (at end)
    /[-–]\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\s*$/,
    // "Something - First Last - Something"
    /[-–]\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[-–]/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const name = match[1].trim();
      // Validate it looks like a real name (2+ chars per word, no numbers)
      const parts = name.split(/\s+/);
      if (parts.length >= 2 && parts.every(p => p.length >= 2 && /^[A-Za-z]+$/.test(p))) {
        return name;
      }
    }
  }

  return null;
}

/**
 * Detect if an email body contains medical certificate content.
 * Simple heuristic based on keywords.
 */
export function detectsCertificateContent(subject: string, bodyText?: string | null): boolean {
  const text = `${subject} ${bodyText || ""}`.toLowerCase();
  const certKeywords = [
    "medical certificate",
    "certificate of capacity",
    "fitness for duty",
    "unfit for work",
    "fit for work",
    "partial capacity",
    "clearance certificate",
    "work capacity certificate",
  ];
  return certKeywords.some(kw => text.includes(kw));
}
