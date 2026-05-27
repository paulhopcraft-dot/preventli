/**
 * RTW Multi-Party Plan Distribution — Recipient Resolver
 *
 * Pure deterministic function that, given a case + plan + contact list,
 * resolves the per-party recipient list for an RTW plan distribution.
 *
 * Why a pure function (not an LLM):
 * The WorkCover-claim → insurer-CC rule is a compliance / deed requirement
 * (per ~/.claude/rules/architectural-principles.md "Separate LLM Reasoning
 * from Deterministic Decisions"). Who gets the email must be auditable and
 * reproducible. LLM generates the plan body only.
 *
 * Recipient rules (deterministic):
 *   - worker:          always required and gating
 *   - manager:         always required and gating (from case_contacts.role = 'employer_primary')
 *   - treating doctor: always required and gating (from case_contacts.role = 'treating_gp')
 *   - physio:          included AND gating if a 'physiotherapist' contact exists
 *   - insurer CM:      included AND COURTESY (NOT gating) if worker_cases.claimNumber
 *                      is populated AND a 'insurer' contact exists
 *
 * If worker email / manager / doctor is missing → throws RecipientResolutionError.
 * If WorkCover claim (claimNumber set) but no 'insurer' contact → throws.
 *
 * Phase 1 scope: this module ships the resolver + types only. Routes that
 * consume it land in phase 2; the distribute-screen UI in phase 3/4.
 */

export type RTWRecipientRole = "worker" | "manager" | "doctor" | "physio" | "insurer";

export interface ResolvedRecipient {
  role: RTWRecipientRole;
  /**
   * case_contacts.id for manager/doctor/physio/insurer.
   * `null` for `worker` because the worker email lives on worker_cases.workerEmail
   * (not in case_contacts) and per-recipient response tracking for the worker
   * is stored on worker_cases-side fields in v1 (or a worker case_contacts row
   * if the org chose to create one — but the resolver does NOT require it).
   */
  contactId: string | null;
  name: string;
  email: string;
  /**
   * Gating parties must respond before the plan can transition to
   * 'all_responded'. Insurer is courtesy-only (NOT gating).
   */
  isGating: boolean;
}

export interface RecipientResolverContact {
  id: string;
  role: string; // raw case_contacts.role text
  name: string;
  email: string | null;
  isActive: boolean;
}

export interface RecipientResolverInput {
  workerName: string;
  workerEmail: string | null;
  /**
   * worker_cases.claimNumber. NULL = preventative case (no WorkCover).
   * Populated = WorkCover claim → insurer CC required.
   */
  claimNumber: string | null;
  contacts: RecipientResolverContact[];
}

export type RecipientResolutionErrorCode =
  | "MISSING_WORKER_EMAIL"
  | "MISSING_MANAGER"
  | "MISSING_DOCTOR"
  | "MISSING_INSURER_FOR_WORKCOVER";

export class RecipientResolutionError extends Error {
  public readonly code: RecipientResolutionErrorCode;
  constructor(code: RecipientResolutionErrorCode, message: string) {
    super(message);
    this.name = "RecipientResolutionError";
    this.code = code;
  }
}

/**
 * Find the first active case_contacts row with the given role and a non-empty email.
 * Returns null if no active contact with a usable email exists for that role.
 */
function findActiveContact(
  contacts: RecipientResolverContact[],
  role: string,
): RecipientResolverContact | null {
  for (const c of contacts) {
    if (c.role === role && c.isActive && c.email && c.email.trim().length > 0) {
      return c;
    }
  }
  return null;
}

/**
 * Resolve the recipient list for a plan distribution.
 *
 * Throws RecipientResolutionError for missing required contacts; the caller
 * (route handler) should translate the error code into a blocking UI
 * message pointing the practitioner at the case-contacts page.
 */
export function resolveRecipients(input: RecipientResolverInput): ResolvedRecipient[] {
  const recipients: ResolvedRecipient[] = [];

  // Worker — always required, always gating.
  if (!input.workerEmail || input.workerEmail.trim().length === 0) {
    throw new RecipientResolutionError(
      "MISSING_WORKER_EMAIL",
      "Worker email is required before the plan can be distributed.",
    );
  }
  recipients.push({
    role: "worker",
    contactId: null,
    name: input.workerName,
    email: input.workerEmail,
    isGating: true,
  });

  // Manager (employer_primary) — always required, always gating.
  const manager = findActiveContact(input.contacts, "employer_primary");
  if (!manager) {
    throw new RecipientResolutionError(
      "MISSING_MANAGER",
      "Manager contact (employer_primary) with a valid email is required before the plan can be distributed.",
    );
  }
  recipients.push({
    role: "manager",
    contactId: manager.id,
    name: manager.name,
    email: manager.email!, // findActiveContact guarantees non-empty
    isGating: true,
  });

  // Treating doctor — always required, always gating.
  const doctor = findActiveContact(input.contacts, "treating_gp");
  if (!doctor) {
    throw new RecipientResolutionError(
      "MISSING_DOCTOR",
      "Treating doctor contact (treating_gp) with a valid email is required before the plan can be distributed.",
    );
  }
  recipients.push({
    role: "doctor",
    contactId: doctor.id,
    name: doctor.name,
    email: doctor.email!,
    isGating: true,
  });

  // Physio — included AND gating only if a contact exists. Optional.
  const physio = findActiveContact(input.contacts, "physiotherapist");
  if (physio) {
    recipients.push({
      role: "physio",
      contactId: physio.id,
      name: physio.name,
      email: physio.email!,
      isGating: true,
    });
  }

  // Insurer — required IF claimNumber populated (WorkCover claim). COURTESY (not gating).
  const isWorkCover = !!(input.claimNumber && input.claimNumber.trim().length > 0);
  if (isWorkCover) {
    const insurer = findActiveContact(input.contacts, "insurer");
    if (!insurer) {
      throw new RecipientResolutionError(
        "MISSING_INSURER_FOR_WORKCOVER",
        "Insurer case manager contact is required for WorkCover-claim cases before the plan can be distributed.",
      );
    }
    recipients.push({
      role: "insurer",
      contactId: insurer.id,
      name: insurer.name,
      email: insurer.email!,
      isGating: false, // courtesy CC
    });
  }

  return recipients;
}

// ============================================================================
// Phase 2 — Per-role templates + preview builder + status computer
// ============================================================================

/**
 * Hard-coded per-role greeting (first paragraph) and ask (closing sentence).
 *
 * Marketing copy stays consistent — these are NOT LLM-generated. The LLM
 * generates the plan body in the middle; greeting and ask are deterministic.
 *
 * Doctor and physio share the salutation pattern but read distinctly because
 * doctors get "Dr <lastName>" and physios get their full name.
 */
export interface TemplateContext {
  workerName: string;
  companyName: string;
  recipientName: string;
  claimNumber: string | null; // populated for insurer only (WorkCover claim)
}

function doctorLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

export function renderGreeting(role: RTWRecipientRole, ctx: TemplateContext): string {
  switch (role) {
    case "worker":
      return `Hi ${ctx.recipientName}, here's the proposed RTW plan we've put together with ${ctx.companyName}. We'd like to hear your thoughts before we finalise it.`;
    case "manager":
      return `Hi ${ctx.recipientName}, here's the proposed RTW plan for ${ctx.workerName}. Please confirm the role and duties are workable for your team.`;
    case "doctor":
      return `Dear Dr ${doctorLastName(ctx.recipientName)}, please review the proposed RTW plan for ${ctx.workerName}. Would you like to add to or vary any of the constraints?`;
    case "physio":
      return `Dear ${ctx.recipientName}, please review the proposed RTW plan for ${ctx.workerName}. Would you like to add to or vary any of the constraints?`;
    case "insurer":
      // resolveRecipients guarantees claimNumber is non-empty when role='insurer'
      // (insurer is only included for WorkCover claims). The fallback would be dead code.
      return `Dear ${ctx.recipientName}, courtesy notification of the proposed RTW plan for ${ctx.workerName}, claim ${ctx.claimNumber}. Please respond if you have any concerns or questions.`;
  }
}

export function renderAsk(role: RTWRecipientRole): string {
  switch (role) {
    case "worker":
      return "What do you think — are you comfortable starting this plan?";
    case "manager":
      return "Is the role and the proposed schedule workable for your team?";
    case "doctor":
      return "Would you like to vary any constraints before we finalise this plan?";
    case "physio":
      return "Would you like to vary any constraints before we finalise this plan?";
    case "insurer":
      return "No action required — please reply if you have any concerns.";
  }
}

export interface DistributionPreviewRecipient {
  role: RTWRecipientRole;
  contactId: string | null;
  name: string;
  to: string;
  subject: string;
  body: string;
  isGating: boolean;
}

export interface BuildPreviewInput {
  recipients: ResolvedRecipient[];
  workerName: string;
  companyName: string;
  claimNumber: string | null;
  /** LLM-generated canonical plan body (one version per plan, NOT per-party). */
  planBody: string;
  /** Subject line shared across all recipients. */
  subject: string;
}

/**
 * Build the per-recipient preview envelopes. Pure — no I/O, no LLM call.
 *
 * Order matches resolveRecipients(): worker, manager, doctor, [physio], [insurer].
 * Each body = greeting + blank line + planBody + blank line + ask.
 */
export function buildDistributionPreview(
  input: BuildPreviewInput,
): DistributionPreviewRecipient[] {
  return input.recipients.map((r) => {
    const ctx: TemplateContext = {
      workerName: input.workerName,
      companyName: input.companyName,
      recipientName: r.name,
      claimNumber: input.claimNumber,
    };
    const greeting = renderGreeting(r.role, ctx);
    const ask = renderAsk(r.role);
    const body = `${greeting}\n\n${input.planBody.trim()}\n\n${ask}`;
    return {
      role: r.role,
      contactId: r.contactId,
      name: r.name,
      to: r.email,
      subject: input.subject,
      body,
      isGating: r.isGating,
    };
  });
}

/**
 * Compute the plan's distribution_status from per-contact tracking + current status.
 *
 * Rules:
 *   - If current status is 'finalised', returns 'finalised' (terminal — never downgrades).
 *   - Otherwise:
 *     - If no gating contact has lastDistributedAt: 'not_distributed'.
 *     - Else if not ALL gating contacts have lastDistributedAt: 'not_distributed'
 *       (partial send — practitioner must retry the failures before the plan can
 *       move forward. Otherwise the plan would hang in awaiting_responses waiting
 *       for a reply to an email the recipient never received.)
 *     - Else if all gating contacts have respondedAt: 'all_responded'.
 *     - Else: 'awaiting_responses'.
 *
 * The worker is gating but has no contactId (worker email is on worker_cases),
 * so the caller passes a synthetic record with `role: 'worker'` for the worker's
 * tracking state. v1 implementation: the distribute route upserts a
 * `role='worker'` case_contacts row on first send so the worker's
 * lastDistributedAt and respondedAt have a home.
 */
export interface DistributionTrackingRecord {
  role: RTWRecipientRole;
  isGating: boolean;
  lastDistributedAt: Date | null;
  respondedAt: Date | null;
}

export function computeDistributionStatus(
  currentStatus: import("@shared/schema").RTWDistributionStatus,
  tracking: DistributionTrackingRecord[],
): import("@shared/schema").RTWDistributionStatus {
  if (currentStatus === "finalised") {
    return "finalised";
  }
  const gating = tracking.filter((t) => t.isGating);
  if (gating.length === 0) {
    return "not_distributed";
  }
  // All gating parties must have received the email — otherwise the plan would
  // hang waiting for a reply that won't come. Council finding: partial-send edge
  // case where e.g. doctor send fails but worker+manager succeed.
  const allDistributed = gating.every((t) => t.lastDistributedAt !== null);
  if (!allDistributed) {
    return "not_distributed";
  }
  const allResponded = gating.every((t) => t.respondedAt !== null);
  if (allResponded) {
    return "all_responded";
  }
  return "awaiting_responses";
}
