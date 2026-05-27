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
