/**
 * Email Draft Service v1
 *
 * AI-powered email drafting for IR/RTW case managers.
 * Uses case context (timeline, certificates, actions, compliance)
 * to generate professional emails for various scenarios.
 */

import { callClaude } from "../lib/claude-cli";
import type { IStorage } from "../storage";
import { fetchCaseContext, CaseContext } from "./smartSummary";
import type {
  EmailDraft,
  EmailDraftDB,
  EmailDraftType,
  EmailRecipientType,
  EmailTone,
  EmailDraftRequest,
  EmailTypeInfo,
  InsertEmailDraft,
} from "@shared/schema";

const MODEL = "claude-3-haiku-20240307";

// Email type configurations with labels, descriptions, and prompt guidance
const EMAIL_TYPE_CONFIG: Record<EmailDraftType, { label: string; description: string; defaultRecipient: EmailRecipientType; guidance: string }> = {
  initial_contact: {
    label: "Initial Contact",
    description: "First contact with worker after case referral",
    defaultRecipient: "worker",
    guidance: `
- Introduce yourself and your role as case manager
- Explain the purpose of the case management service
- Express support for their recovery and return to work
- Outline next steps (initial check-in, certificate requirements)
- Provide your contact details
- Use a warm, supportive tone
    `.trim(),
  },
  certificate_chase: {
    label: "Certificate Chase",
    description: "Request updated medical certificate",
    defaultRecipient: "worker",
    guidance: `
- Reference current certificate status (expired/expiring)
- Clearly state what's needed (updated medical certificate)
- Explain why it's important (continued support, WorkCover compliance)
- Provide deadline if applicable
- Offer assistance if they have difficulties obtaining one
- Use a firm but supportive tone
    `.trim(),
  },
  check_in_follow_up: {
    label: "Check-In Follow Up",
    description: "Follow up after missed or concerning check-ins",
    defaultRecipient: "worker",
    guidance: `
- Note missed check-in(s) or concerning responses
- Express genuine concern for their wellbeing
- Request they make contact at their earliest convenience
- Remind them of support available
- Use a supportive, non-accusatory tone
    `.trim(),
  },
  rtw_update: {
    label: "RTW Progress Update",
    description: "Update on return-to-work progress",
    defaultRecipient: "worker",
    guidance: `
- Summarize current RTW status and progress
- Note achievements and milestones
- Outline next phase/steps in the RTW plan
- Address any concerns from recent check-ins
- Use a positive, encouraging tone
    `.trim(),
  },
  duties_proposal: {
    label: "Suitable Duties Proposal",
    description: "Propose modified or suitable duties",
    defaultRecipient: "employer",
    guidance: `
- Reference current work capacity from certificate
- Propose specific suitable duties based on restrictions
- Explain how proposed duties align with medical restrictions
- Request feedback and acceptance
- Use a collaborative, professional tone
    `.trim(),
  },
  non_compliance_warning: {
    label: "Non-Compliance Notice",
    description: "Address compliance issues formally",
    defaultRecipient: "worker",
    guidance: `
- State specific compliance issues factually
- Reference relevant WorkCover obligations
- Explain potential consequences clearly
- Offer opportunity to rectify the situation
- Provide support options available
- Use a firm, professional tone - not threatening
    `.trim(),
  },
  employer_update: {
    label: "Employer Update",
    description: "Progress update for employer/host",
    defaultRecipient: "employer",
    guidance: `
- Professional summary of case status
- Current work capacity and restrictions
- RTW progress and timeline
- Any actions required from employer
- Use a formal, factual tone
    `.trim(),
  },
  insurer_report: {
    label: "Insurer Report",
    description: "Summary report for WorkCover insurer",
    defaultRecipient: "insurer",
    guidance: `
- Structured summary format
- Key dates and milestones
- Current status and prognosis
- Compliance status and any issues
- Recommendations for next steps
- Use a formal, clinical tone
    `.trim(),
  },
  general_response: {
    label: "General Response",
    description: "General case-related correspondence",
    defaultRecipient: "worker",
    guidance: `
- Address the specific query or situation
- Provide relevant case information
- Clear next steps if applicable
- Use a professional, helpful tone
    `.trim(),
  },
};

/**
 * Get all email types with their labels and descriptions for UI
 */
export function getEmailTypes(): EmailTypeInfo[] {
  return Object.entries(EMAIL_TYPE_CONFIG).map(([value, config]) => ({
    value: value as EmailDraftType,
    label: config.label,
    description: config.description,
    defaultRecipient: config.defaultRecipient,
  }));
}

/**
 * Map database record to API type
 */
function mapEmailDraftDbToApi(db: EmailDraftDB): EmailDraft {
  return {
    id: db.id,
    caseId: db.caseId,
    emailType: db.emailType as EmailDraftType,
    recipient: db.recipient as EmailRecipientType,
    recipientName: db.recipientName,
    recipientEmail: db.recipientEmail,
    subject: db.subject,
    body: db.body,
    tone: db.tone as EmailTone,
    additionalContext: db.additionalContext,
    status: db.status as EmailDraft["status"],
    createdBy: db.createdBy,
    createdAt: db.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: db.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Build the prompt for email generation
 */
function buildEmailPrompt(
  context: CaseContext,
  request: EmailDraftRequest
): string {
  const { workerCase, timeline, certificates, actions, compliance } = context;
  const config = EMAIL_TYPE_CONFIG[request.emailType];

  // Format timeline (recent events)
  const timelineText = timeline.length > 0
    ? timeline
        .slice(0, 10)
        .map((e) => `- [${new Date(e.timestamp).toLocaleDateString("en-AU")}] ${e.eventType}: ${e.title}`)
        .join("\n")
    : "No recent timeline events.";

  // Format certificates
  const certificatesText = certificates.length > 0
    ? certificates
        .slice(0, 3)
        .map((c) => `- ${c.capacity.toUpperCase()}: ${new Date(c.startDate).toLocaleDateString("en-AU")} to ${new Date(c.endDate).toLocaleDateString("en-AU")}${c.notes ? ` (${c.notes.slice(0, 100)})` : ""}`)
        .join("\n")
    : "No certificates on file.";

  // Format pending actions
  const pendingActions = actions.filter((a) => a.status === "pending");
  const actionsText = pendingActions.length > 0
    ? pendingActions
        .slice(0, 5)
        .map((a) => `- ${a.type.replace(/_/g, " ")}${a.dueDate ? ` (due: ${new Date(a.dueDate).toLocaleDateString("en-AU")})` : ""}`)
        .join("\n")
    : "No pending actions.";

  // Compliance status
  const complianceText = `${compliance.status.replace(/_/g, " ").toUpperCase()}: ${compliance.message}`;

  // Recipient display
  const recipientDisplay = request.recipientName
    ? `${request.recipient} (${request.recipientName})`
    : request.recipient;

  // Tone description
  const toneDescriptions: Record<EmailTone, string> = {
    formal: "Professional, business-like language",
    supportive: "Warm, empathetic, and encouraging",
    firm: "Direct and clear, while remaining professional",
  };

  return `You are drafting a professional email for a workplace injury case manager in Victoria, Australia.

EMAIL TYPE: ${config.label}
RECIPIENT: ${recipientDisplay}
TONE: ${request.tone || "formal"} - ${toneDescriptions[request.tone || "formal"]}

CASE CONTEXT:
- Worker: ${workerCase.workerName}
- Company: ${workerCase.company}
- Date of Injury: ${workerCase.dateOfInjury}
- Current Work Status: ${workerCase.workStatus}
- Risk Level: ${workerCase.riskLevel}
- Case Status: ${workerCase.currentStatus || "Open"}
- Next Step: ${workerCase.nextStep || "Not specified"}

CERTIFICATE STATUS:
${certificatesText}

COMPLIANCE STATUS:
${complianceText}

RECENT TIMELINE:
${timelineText}

PENDING ACTIONS:
${actionsText}

${request.additionalContext ? `ADDITIONAL CONTEXT TO ADDRESS:\n${request.additionalContext}` : ""}

GUIDELINES FOR THIS EMAIL TYPE:
${config.guidance}

IMPORTANT RULES:
- Write as a professional case manager in Australia
- Use Australian English spelling (favour, colour, organisation, etc.)
- Be clear, concise, and actionable
- Do NOT make medical diagnoses or legal determinations
- Do NOT promise specific outcomes
- Reference specific case details to personalize the email
- Keep reasonable length (not too long)
- Sign off appropriately (e.g., "Kind regards," or "Best regards,")
- Do NOT include sender name/title - leave for user to add

Generate the email in this exact format:
Subject: [subject line here]

[email body here starting with appropriate greeting]`;
}

/**
 * Parse the AI response to extract subject and body
 */
function parseEmailResponse(responseText: string): { subject: string; body: string } {
  // Clean up any markdown formatting
  let cleaned = responseText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
  }

  // Extract subject line
  const subjectMatch = cleaned.match(/^Subject:\s*(.+?)(?:\n|$)/i);
  const subject = subjectMatch ? subjectMatch[1].trim() : "Case Management Update";

  // Extract body (everything after subject line)
  let body = cleaned;
  if (subjectMatch) {
    body = cleaned.slice(subjectMatch[0].length).trim();
  }

  // Remove any leading "Body:" prefix if present
  body = body.replace(/^Body:\s*/i, "").trim();

  return { subject, body };
}

/**
 * Generate an email draft using AI
 */
export async function generateEmailDraft(
  storage: IStorage,
  caseId: string,
  organizationId: string,
  request: EmailDraftRequest,
  userId: string
): Promise<EmailDraft> {
  // Fetch case context (reusing from smartSummary)
  const context = await fetchCaseContext(storage, caseId, organizationId);

  // Build the prompt
  const prompt = buildEmailPrompt(context, request);

  // Call Claude CLI — Max plan OAuth, no API key needed
  const responseText = await callClaude(prompt);

  // Parse the response
  const { subject, body } = parseEmailResponse(responseText);

  // Save to database
  const draftInput: InsertEmailDraft = {
    organizationId,
    caseId,
    emailType: request.emailType,
    recipient: request.recipient,
    recipientName: request.recipientName ?? null,
    recipientEmail: request.recipientEmail ?? null,
    subject,
    body,
    tone: request.tone ?? "formal",
    additionalContext: request.additionalContext ?? null,
    caseContextSnapshot: {
      workerName: context.workerCase.workerName,
      company: context.workerCase.company,
      workStatus: context.workerCase.workStatus,
      complianceStatus: context.compliance.status,
      generatedAt: new Date().toISOString(),
    },
    status: "draft",
    createdBy: userId,
  } as any;

  const savedDraft = await storage.createEmailDraft(draftInput);
  return mapEmailDraftDbToApi(savedDraft);
}

/**
 * Get email drafts for a case
 */
export async function getEmailDraftsByCase(
  storage: IStorage,
  caseId: string,
  organizationId: string
): Promise<EmailDraft[]> {
  const drafts = await storage.getEmailDraftsByCase(caseId, organizationId);
  return drafts.map(mapEmailDraftDbToApi);
}

/**
 * Get a single email draft by ID
 */
export async function getEmailDraftById(
  storage: IStorage,
  id: string
): Promise<EmailDraft | null> {
  const draft = await storage.getEmailDraftById(id);
  return draft ? mapEmailDraftDbToApi(draft) : null;
}

/**
 * Update an email draft
 */
export async function updateEmailDraft(
  storage: IStorage,
  id: string,
  updates: Partial<InsertEmailDraft>
): Promise<EmailDraft> {
  const updated = await storage.updateEmailDraft(id, updates);
  return mapEmailDraftDbToApi(updated);
}

/**
 * Delete an email draft
 */
export async function deleteEmailDraft(
  storage: IStorage,
  id: string
): Promise<void> {
  await storage.deleteEmailDraft(id);
}
